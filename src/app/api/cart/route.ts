import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  addCartItem,
  cartItemSchema,
  clearCart,
  domainErrorResponse,
  getCartItems,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/cart";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ items: await getCartItems(auth.session.user.id) });
  } catch (error) {
    return serverErrorResponse(error, "CART_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const payload = cartItemSchema.parse(await request.json());
    const item = await addCartItem(auth.session.user.id, payload);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "CART_ITEM_ADD_FAILED");
  }
}

export async function DELETE() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    await clearCart(auth.session.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return serverErrorResponse(error, "CART_CLEAR_FAILED");
  }
}
