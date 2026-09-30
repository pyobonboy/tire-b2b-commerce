import { NextResponse } from "next/server";
import {
  requireSeller,
  serverErrorResponse,
  submitSellerListing,
} from "@/lib/server/seller";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const result = await submitSellerListing(auth.sellerId, id);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "LISTING_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json(
        { error: "LISTING_CANNOT_BE_SUBMITTED", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ listing: result.listing });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_LISTING_SUBMIT_FAILED");
  }
}
