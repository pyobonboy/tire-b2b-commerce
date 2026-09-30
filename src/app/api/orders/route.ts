import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createBuyerOrders,
  createOrderSchema,
  domainErrorResponse,
  getBuyerOrders,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/orders";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const orders = await getBuyerOrders(auth.session.user.id);
    return NextResponse.json({ orders });
  } catch (error) {
    return serverErrorResponse(error, "BUYER_ORDERS_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const payload = createOrderSchema.parse(await request.json());
    const orders = await createBuyerOrders(auth.session.user.id, payload);
    return NextResponse.json({ orders }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "BUYER_ORDER_CREATE_FAILED");
  }
}
