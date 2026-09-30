import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import {
  processReturnRequest,
  processReturnRequestSchema,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/returns";

export const runtime = "nodejs";

// REQUESTED -> APPROVED or REJECTED, admin override (any seller's request).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = processReturnRequestSchema.parse(await request.json());
    const result = await processReturnRequest(id, { kind: "ADMIN", userId: auth.adminId }, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "RETURN_REQUEST_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "INVALID_RETURN_REQUEST_STATUS" }, { status: 409 });
    }
    if (result.kind === "REASON_REQUIRED") {
      return NextResponse.json({ error: "REJECT_REASON_REQUIRED" }, { status: 400 });
    }
    return NextResponse.json({ returnRequest: result.returnRequest });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_RETURN_REQUEST_PROCESS_FAILED");
  }
}
