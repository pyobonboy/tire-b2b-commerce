import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  domainErrorResponse,
  serverErrorResponse,
  setDefaultShippingAddress,
} from "@/lib/server/shippingAddress";

export const runtime = "nodejs";

const BUYER_ONLY = ["BUYER"] as const;

// Deliberately its own endpoint rather than a field on PATCH .../[id] — see
// the module header in src/lib/server/shippingAddress.ts for why "change
// which address is default" is kept as one single, separately-reasoned
// operation instead of folding into the general field-update path.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(BUYER_ONLY);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const address = await setDefaultShippingAddress(auth.session.user.id, id);
    return NextResponse.json({ address });
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "SHIPPING_ADDRESS_SET_DEFAULT_FAILED");
  }
}
