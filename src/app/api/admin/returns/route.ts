import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { getAdminReturnRequests, serverErrorResponse } from "@/lib/server/returns";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const returnRequests = await getAdminReturnRequests(url.searchParams.get("status") ?? undefined);
    return NextResponse.json({ returnRequests });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_RETURN_REQUESTS_READ_FAILED");
  }
}
