import { NextResponse } from "next/server";
import { markPayoutPaid } from "@/lib/server/payout";
import { requireAdmin, serverErrorResponse } from "@/lib/server/admin";

export const runtime = "nodejs";

// 지급 완료 — CONFIRMED -> PAID only. See markPayoutPaid in payout.ts.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const result = await markPayoutPaid(id, auth.adminId);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "SETTLEMENT_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json(
        { error: "SETTLEMENT_CANNOT_BE_MARKED_PAID", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ settlement: result.settlement });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_SETTLEMENT_MARK_PAID_FAILED");
  }
}
