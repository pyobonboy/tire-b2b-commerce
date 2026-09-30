import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  deleteShippingAddress,
  domainErrorResponse,
  serverErrorResponse,
  updateShippingAddress,
  updateShippingAddressSchema,
  validationResponse,
} from "@/lib/server/shippingAddress";

export const runtime = "nodejs";

const BUYER_ONLY = ["BUYER"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(BUYER_ONLY);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = updateShippingAddressSchema.parse(await request.json());
    const address = await updateShippingAddress(auth.session.user.id, id, payload);
    return NextResponse.json({ address });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SHIPPING_ADDRESS_UPDATE_FAILED");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(BUYER_ONLY);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    await deleteShippingAddress(auth.session.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SHIPPING_ADDRESS_DELETE_FAILED");
  }
}
