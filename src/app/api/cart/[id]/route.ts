import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  cartQuantitySchema,
  domainErrorResponse,
  removeCartItem,
  serverErrorResponse,
  updateCartItem,
  validationResponse,
} from "@/lib/server/cart";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = cartQuantitySchema.parse(await request.json());
    const item = await updateCartItem(auth.session.user.id, id, payload.quantity);
    return NextResponse.json({ item });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "CART_ITEM_UPDATE_FAILED");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    await removeCartItem(auth.session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "CART_ITEM_REMOVE_FAILED");
  }
}
