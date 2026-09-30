import { NextResponse } from "next/server";
import {
  confirmPayout,
  confirmPayoutSchema,
  getAdminSettlements,
  getAdminUnsettledBySeller,
  getCurrentMonthPeriod,
  parsePeriodRange,
} from "@/lib/server/payout";
import { requireAdmin, serverErrorResponse, validationResponse } from "@/lib/server/admin";
import type { AdminPayoutView } from "@/lib/payout-types";

export const runtime = "nodejs";

// GET: per-seller unsettled totals for a chosen (or default current-month)
// period, plus the full settlement history (optionally filtered by status).
// The unsettled totals are always a live calculation — see
// getAdminUnsettledBySeller's comment in payout.ts for why this has to be a
// raw aggregate query rather than a plain findMany.
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const periodStartParam = url.searchParams.get("periodStart");
    const periodEndParam = url.searchParams.get("periodEnd");
    const period =
      periodStartParam && periodEndParam
        ? parsePeriodRange(periodStartParam, periodEndParam)
        : getCurrentMonthPeriod();
    if (!period) {
      return NextResponse.json({ error: "INVALID_PERIOD" }, { status: 400 });
    }

    const statusParam = url.searchParams.get("status") ?? undefined;
    const [unsettledBySeller, settlements] = await Promise.all([
      getAdminUnsettledBySeller(period.start, period.end),
      getAdminSettlements(statusParam),
    ]);

    const payout: AdminPayoutView = {
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      unsettledBySeller,
      settlements,
    };
    return NextResponse.json({ payout });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_SETTLEMENTS_READ_FAILED");
  }
}

// POST: 정산 확정 — snapshots one seller's live unsettled total for a chosen
// period into a new CONFIRMED Settlement row and claims the orders it was
// computed from. See confirmPayout in payout.ts for the full transaction and
// the double-claim guard.
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const payload = confirmPayoutSchema.parse(await request.json());
    const period = parsePeriodRange(payload.periodStart, payload.periodEnd);
    if (!period) {
      return NextResponse.json({ error: "INVALID_PERIOD" }, { status: 400 });
    }

    const result = await confirmPayout(
      payload.sellerId,
      period.start,
      period.end,
      auth.adminId,
      payload.memo ?? null,
    );
    if (result.kind === "SELLER_NOT_FOUND") {
      return NextResponse.json({ error: "SELLER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "NO_SETTLEABLE_ORDERS") {
      return NextResponse.json({ error: "NO_SETTLEABLE_ORDERS" }, { status: 409 });
    }
    if (result.kind === "CLAIM_CONFLICT") {
      return NextResponse.json({ error: "SETTLEMENT_CLAIM_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json(
      { settlement: result.settlement, claimedOrderCount: result.claimedOrderCount },
      { status: 201 },
    );
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_SETTLEMENT_CONFIRM_FAILED");
  }
}
