import type { NextRequest } from "next/server";
import { getReviewOverviewForListings, serverErrorResponse } from "@/lib/server/review";

export const runtime = "nodejs";

// Public, like GET /api/products/[id] — review ratings/text are a trust
// signal meant to help a visitor decide whether to sign up/buy, same spirit
// as the product spec fields that page already shows to logged-out visitors
// (only price/stock are gated behind login there).
const MAX_LISTING_IDS = 50;

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("listingIds") ?? "";
    const listingIds = raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_LISTING_IDS);

    const overview = await getReviewOverviewForListings(listingIds);
    return Response.json(overview);
  } catch (error) {
    return serverErrorResponse(error, "REVIEW_OVERVIEW_FAILED");
  }
}
