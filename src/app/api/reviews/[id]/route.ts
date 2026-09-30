import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  domainErrorResponse,
  serverErrorResponse,
  updateReview,
  updateReviewSchema,
  validationResponse,
} from "@/lib/server/review";

export const runtime = "nodejs";

// Editing is author-only (see review.ts's module doc comment for why there
// is no DELETE here).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = updateReviewSchema.parse(await request.json());
    const review = await updateReview(id, auth.session.user.id, payload);
    return NextResponse.json({ review });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "REVIEW_UPDATE_FAILED");
  }
}
