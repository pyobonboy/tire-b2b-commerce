import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  cancelOrder,
  cancelOrderSchema,
  domainErrorResponse,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/orders";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = cancelOrderSchema.parse(await request.json());
    const order = await cancelOrder(id, { kind: "BUYER", userId: auth.session.user.id }, payload.reason);
    return NextResponse.json({ order });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "BUYER_ORDER_CANCEL_FAILED");
  }
}
