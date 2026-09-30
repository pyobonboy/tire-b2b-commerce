import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { removeWishlist, serverErrorResponse } from "@/lib/server/wishlist";

export const runtime = "nodejs";

const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const removed = await removeWishlist(auth.session.user.id, id);
    return removed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "WISHLIST_ITEM_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    return serverErrorResponse(error, "WISHLIST_REMOVE_FAILED");
  }
}
