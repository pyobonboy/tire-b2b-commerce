import { NextResponse } from "next/server";
import {
  adminSuspendSchema,
  requireAdmin,
  serverErrorResponse,
  suspendAdminBuyer,
  validationResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = adminSuspendSchema.parse(await request.json());
    const result = await suspendAdminBuyer(id, auth.adminId, payload.reason);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "BUYER_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json(
        { error: "BUYER_ALREADY_SUSPENDED", status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ buyer: result.buyer });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_BUYER_SUSPEND_FAILED");
  }
}
