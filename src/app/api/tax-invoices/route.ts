import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  domainErrorResponse,
  getBuyerTaxInvoices,
  requestTaxInvoice,
  requestTaxInvoiceSchema,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/taxInvoice";

export const runtime = "nodejs";

// GET: the signed-in buyer's own requests — /mypage/tax.
export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const taxInvoices = await getBuyerTaxInvoices(auth.session.user.id);
    return NextResponse.json({ taxInvoices });
  } catch (error) {
    return serverErrorResponse(error, "BUYER_TAX_INVOICES_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const payload = requestTaxInvoiceSchema.parse(await request.json());
    const taxInvoice = await requestTaxInvoice(auth.session.user.id, payload.periodMonth);
    return NextResponse.json({ taxInvoice }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "TAX_INVOICE_REQUEST_FAILED");
  }
}
