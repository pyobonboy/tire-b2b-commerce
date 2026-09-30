import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { getAdminInquiries, serverErrorResponse } from "@/lib/server/inquiry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const inquiries = await getAdminInquiries(url.searchParams.get("status") ?? undefined);
    return NextResponse.json({ inquiries });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_INQUIRY_LIST_FAILED");
  }
}
