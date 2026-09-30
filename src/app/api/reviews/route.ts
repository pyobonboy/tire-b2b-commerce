import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createReview,
  createReviewSchema,
  domainErrorResponse,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/review";

export const runtime = "nodejs";

// Only a BUYER can ever own an Order (see Order.buyerId), so only BUYER can
// write a review — createReview re-derives everything from the order anyway,
// but gating the role here means a SELLER/ADMIN session gets a clean 403
// instead of always hitting NOT_ORDER_OWNER/ORDER_NOT_FOUND.
export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const payload = createReviewSchema.parse(await request.json());
    const review = await createReview(auth.session.user.id, payload);
    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "REVIEW_CREATE_FAILED");
  }
}
