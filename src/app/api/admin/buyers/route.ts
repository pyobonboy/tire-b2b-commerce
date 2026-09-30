import { NextResponse } from "next/server";
import {
  getAdminBuyers,
  requireAdmin,
  serverErrorResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const buyers = await getAdminBuyers(status);
    return NextResponse.json({ buyers });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_BUYERS_READ_FAILED");
  }
}
