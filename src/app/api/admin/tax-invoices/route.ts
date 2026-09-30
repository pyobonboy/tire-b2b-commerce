import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { getAdminTaxInvoices, serverErrorResponse } from "@/lib/server/taxInvoice";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const taxInvoices = await getAdminTaxInvoices(url.searchParams.get("status") ?? undefined);
    return NextResponse.json({ taxInvoices });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_TAX_INVOICES_READ_FAILED");
  }
}
