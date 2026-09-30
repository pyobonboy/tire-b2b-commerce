import { NextResponse } from "next/server";
import {
  getAdminListings,
  requireAdmin,
  serverErrorResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const listings = await getAdminListings(status);
    return NextResponse.json({ listings });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_LISTINGS_READ_FAILED");
  }
}
