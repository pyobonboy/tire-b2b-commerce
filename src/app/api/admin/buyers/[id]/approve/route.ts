import { NextResponse } from "next/server";
import {
  approveAdminBuyer,
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
    const result = await approveAdminBuyer(id, auth.adminId);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "BUYER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json(
        { error: "BUYER_CANNOT_BE_APPROVED", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ buyer: result.buyer });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_BUYER_APPROVE_FAILED");
  }
}
