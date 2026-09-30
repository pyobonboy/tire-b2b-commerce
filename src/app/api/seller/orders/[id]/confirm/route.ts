import { NextResponse } from "next/server";
import {
  confirmSellerOrder,
  requireSeller,
  serverErrorResponse,
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
    const result = await confirmSellerOrder(auth.sellerId, id);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json(
        { error: "ORDER_CONFIRM_INVALID_STATUS", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ order: result.order });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_ORDER_CONFIRM_FAILED");
  }
}
