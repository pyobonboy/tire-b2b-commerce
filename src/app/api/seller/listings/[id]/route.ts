import { NextResponse } from "next/server";
import {
  deleteSellerListing,
  domainErrorResponse,
  getSellerListing,
  listingPatchSchema,
  requireSeller,
  serverErrorResponse,
  updateSellerListing,
  validationResponse,
} from "@/lib/server/seller";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const listing = await getSellerListing(auth.sellerId, id);
    if (!listing) return NextResponse.json({ error: "LISTING_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ listing });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_LISTING_READ_FAILED");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = listingPatchSchema.parse(await request.json());
    const listing = await updateSellerListing(auth.sellerId, id, payload, auth.session.user.id);
    if (!listing) return NextResponse.json({ error: "LISTING_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ listing });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SELLER_LISTING_UPDATE_FAILED");
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const result = await deleteSellerListing(auth.sellerId, id);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "LISTING_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "ONLY_DRAFT_CAN_BE_DELETED" }, { status: 409 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_LISTING_DELETE_FAILED");
  }
}
