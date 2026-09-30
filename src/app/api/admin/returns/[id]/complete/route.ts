import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { completeReturnRequest, serverErrorResponse } from "@/lib/server/returns";

export const runtime = "nodejs";

// APPROVED -> COMPLETED, admin override (any seller's request).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const result = await completeReturnRequest(id, { kind: "ADMIN", userId: auth.adminId });
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "RETURN_REQUEST_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "INVALID_RETURN_REQUEST_STATUS" }, { status: 409 });
    }
    if (result.kind === "ORDER_ALREADY_CANCELLED") {
      return NextResponse.json({ error: "ORDER_ALREADY_CANCELLED" }, { status: 409 });
    }
    if (result.kind === "ORDER_STATE_CHANGED") {
      return NextResponse.json({ error: "ORDER_STATE_CHANGED" }, { status: 409 });
    }
    return NextResponse.json({ returnRequest: result.returnRequest });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_RETURN_REQUEST_COMPLETE_FAILED");
  }
}
