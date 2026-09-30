import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import {
  issueTaxInvoice,
  issueTaxInvoiceSchema,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/taxInvoice";

export const runtime = "nodejs";

// REQUESTED -> ISSUED, recording the external system's own approval number.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = issueTaxInvoiceSchema.parse(await request.json());
    const result = await issueTaxInvoice(id, auth.adminId, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "TAX_INVOICE_NOT_FOUND" }, { status: 404 });
    }
    if (result.kind === "INVALID_STATUS") {
      return NextResponse.json({ error: "INVALID_TAX_INVOICE_STATUS" }, { status: 409 });
    }
    return NextResponse.json({ taxInvoice: result.taxInvoice });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_TAX_INVOICE_ISSUE_FAILED");
  }
}
