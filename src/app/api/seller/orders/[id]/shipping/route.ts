import { NextResponse } from "next/server";
import {
  requireSeller,
  serverErrorResponse,
  shippingSchema,
  updateSellerShipping,
  validationResponse,
} from "@/lib/server/seller";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = shippingSchema.parse(await request.json());
    const result = await updateSellerShipping(auth.sellerId, id, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "ORDER_CANCELLED") {
      return NextResponse.json({ error: "ORDER_CANCELLED" }, { status: 409 });
    }
    if (result.kind === "ORDER_UNPAID") {
      return NextResponse.json({ error: "ORDER_UNPAID" }, { status: 409 });
    }
    if (result.kind === "INVALID_TRANSITION") {
      return NextResponse.json({ error: "INVALID_SHIPPING_TRANSITION" }, { status: 409 });
    }
    if (result.kind === "ORDER_STATE_CHANGED") {
      return NextResponse.json({ error: "ORDER_STATE_CHANGED" }, { status: 409 });
    }
    if (result.kind === "TRACKING_REQUIRED") {
      return NextResponse.json({ error: "TRACKING_NUMBER_REQUIRED" }, { status: 400 });
    }
    return NextResponse.json({ order: result.order });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "SELLER_SHIPPING_UPDATE_FAILED");
  }
}
