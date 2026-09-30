import { NextResponse } from "next/server";
import {
  getSellerOrders,
  requireSeller,
  serverErrorResponse,
} from "@/lib/server/seller";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const orders = await getSellerOrders(auth.sellerId);
    return NextResponse.json({ orders });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_ORDERS_READ_FAILED");
  }
}
