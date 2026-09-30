import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  confirmPurchase,
  domainErrorResponse,
  serverErrorResponse,
} from "@/lib/server/orders";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const order = await confirmPurchase(id, auth.session.user.id);
    return NextResponse.json({ order });
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "BUYER_PURCHASE_CONFIRM_FAILED");
  }
}
