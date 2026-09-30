import { NextResponse } from "next/server";
import {
  reinstateAdminSeller,
  requireAdmin,
  serverErrorResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const result = await reinstateAdminSeller(id, auth.adminId);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "SELLER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "SELLER_CANNOT_BE_REINSTATED", status: result.status }, { status: 409 });
    }
    return NextResponse.json({ seller: result.seller });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_SELLER_REINSTATE_FAILED");
  }
}
