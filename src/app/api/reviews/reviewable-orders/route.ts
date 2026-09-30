import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { getReviewableOrders, serverErrorResponse } from "@/lib/server/review";

export const runtime = "nodejs";

// Backs the order picker shown at /reviews/new when opened without an
// ?orderId — the buyer's own orders that don't have a review yet and are
// eligible to receive one.
export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const orders = await getReviewableOrders(auth.session.user.id);
    return NextResponse.json({ orders });
  } catch (error) {
    return serverErrorResponse(error, "REVIEWABLE_ORDERS_FAILED");
  }
}
