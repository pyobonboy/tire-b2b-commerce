import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { domainErrorResponse, getReviewOrderContext, serverErrorResponse } from "@/lib/server/review";

export const runtime = "nodejs";

// Backs /reviews/new?orderId=... — eligibility + any existing review for one
// order, so the page can render a create form, an edit form, or a "not
// eligible yet" message. getReviewOrderContext enforces ownership itself.
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { orderId } = await params;
    const context = await getReviewOrderContext(orderId, auth.session.user.id);
    return NextResponse.json(context);
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "REVIEW_ORDER_CONTEXT_FAILED");
  }
}
