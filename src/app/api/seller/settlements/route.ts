import { NextResponse } from "next/server";
import { getSellerSettlements, getSellerUnsettledSummary } from "@/lib/server/payout";
import { requireSeller, serverErrorResponse } from "@/lib/server/seller";
import type { SellerPayoutView } from "@/lib/payout-types";

export const runtime = "nodejs";

// Read-only: sellers can see their own 이번 기간 미정산 예상액 and settlement
// history, but never confirm or mark their own payout (that's admin-only —
// see /api/admin/settlements). No period query params here on purpose: the
// seller view is always "이번 기간" (the current month, no picker) — see
// getSellerUnsettledSummary in payout.ts.
export async function GET() {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const [summary, settlements] = await Promise.all([
      getSellerUnsettledSummary(auth.sellerId),
      getSellerSettlements(auth.sellerId),
    ]);
    // requireSeller() already confirmed this sellerId resolves to an ACTIVE
    // Seller row, so a null summary here would mean that row disappeared
    // between the guard and this read — not expected, but handled rather
    // than throwing a generic 500 for something a retry would likely fix.
    if (!summary) {
      return NextResponse.json({ error: "SELLER_NOT_FOUND" }, { status: 404 });
    }

    const payout: SellerPayoutView = {
      commissionRate: summary.commissionRate,
      period: { start: summary.period.start.toISOString(), end: summary.period.end.toISOString() },
      adjustmentAmount: summary.adjustmentAmount,
      unsettled: summary.unsettled,
      settlements,
    };
    return NextResponse.json({ payout });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_SETTLEMENTS_READ_FAILED");
  }
}
