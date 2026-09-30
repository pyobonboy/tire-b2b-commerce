import { NextResponse } from "next/server";
import {
  getAdminSellers,
  requireAdmin,
  serverErrorResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const sellers = await getAdminSellers(status);
    return NextResponse.json({ sellers });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_SELLERS_READ_FAILED");
  }
}
