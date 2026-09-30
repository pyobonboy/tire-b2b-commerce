import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createShippingAddress,
  createShippingAddressSchema,
  domainErrorResponse,
  listShippingAddresses,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/shippingAddress";

export const runtime = "nodejs";

// Buyer-scoped (Task 1) — a shipping address book only matters to the role
// that can place orders, mirroring /api/cart and /api/orders' own role gate
// rather than account settings' broader AUTHENTICATED_ROLES.
const BUYER_ONLY = ["BUYER"] as const;

export async function GET() {
  const auth = await requireRole(BUYER_ONLY);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ addresses: await listShippingAddresses(auth.session.user.id) });
  } catch (error) {
    return serverErrorResponse(error, "SHIPPING_ADDRESS_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(BUYER_ONLY);
  if (auth.response) return auth.response;

  try {
    const payload = createShippingAddressSchema.parse(await request.json());
    const address = await createShippingAddress(auth.session.user.id, payload);
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SHIPPING_ADDRESS_CREATE_FAILED");
  }
}
