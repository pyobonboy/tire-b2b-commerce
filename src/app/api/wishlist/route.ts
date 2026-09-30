import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  getWishlist,
  serverErrorResponse,
  toggleWishlist,
  validationResponse,
  wishSellerSchema,
} from "@/lib/server/wishlist";

export const runtime = "nodejs";

const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function GET() {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ sellers: await getWishlist(auth.session.user.id) });
  } catch (error) {
    return serverErrorResponse(error, "WISHLIST_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const payload = wishSellerSchema.parse(await request.json());
    return NextResponse.json(await toggleWishlist(auth.session.user.id, payload));
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "WISHLIST_TOGGLE_FAILED");
  }
}
