import { NextResponse } from "next/server";
import {
  adminReviewSchema,
  requireAdmin,
  reviewAdminListing,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = adminReviewSchema.parse(await request.json());
    const result = await reviewAdminListing(id, auth.adminId, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "LISTING_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "LISTING_NOT_PENDING", status: result.status }, { status: 409 });
    }
    if (result.kind === "REASON_REQUIRED") {
      return NextResponse.json({ error: "REJECTION_REASON_REQUIRED" }, { status: 400 });
    }
    return NextResponse.json({ listing: result.listing });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_LISTING_REVIEW_FAILED");
  }
}
