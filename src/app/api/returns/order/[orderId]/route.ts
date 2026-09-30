import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { domainErrorResponse, getReturnRequestOrderContext, serverErrorResponse } from "@/lib/server/returns";

export const runtime = "nodejs";

// Backs /mypage/returns/new?orderId=... — eligibility + any existing request
// for one order, so the page can render a create form, a status view, or a
// "not eligible" message. getReturnRequestOrderContext enforces ownership
// itself. Mirrors GET /api/reviews/order/[orderId] exactly.
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { orderId } = await params;
    const context = await getReturnRequestOrderContext(orderId, auth.session.user.id);
    return NextResponse.json(context);
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "RETURN_REQUEST_ORDER_CONTEXT_FAILED");
  }
}
