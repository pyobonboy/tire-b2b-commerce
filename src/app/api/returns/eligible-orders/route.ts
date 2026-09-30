import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { getReturnEligibleOrders, serverErrorResponse } from "@/lib/server/returns";

export const runtime = "nodejs";

// Backs the order picker shown at /mypage/returns/new when opened without an
// ?orderId — the buyer's own delivered orders that don't have a
// exchange/return request yet.
export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const orders = await getReturnEligibleOrders(auth.session.user.id);
    return NextResponse.json({ orders });
  } catch (error) {
    return serverErrorResponse(error, "RETURN_ELIGIBLE_ORDERS_FAILED");
  }
}
