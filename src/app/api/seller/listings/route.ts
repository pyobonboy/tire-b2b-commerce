import { NextResponse } from "next/server";
import {
  createSellerListing,
  domainErrorResponse,
  getSellerListings,
  listingSchema,
  requireSeller,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/seller";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const listings = await getSellerListings(auth.sellerId, status);
    return NextResponse.json({ listings });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_LISTINGS_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const payload = listingSchema.parse(await request.json());
    const listing = await createSellerListing(auth.sellerId, payload);
    return NextResponse.json({ listing }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SELLER_LISTING_CREATE_FAILED");
  }
}
