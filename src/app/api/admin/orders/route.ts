import { NextResponse } from "next/server";
import {
  getAdminOrders,
  requireAdmin,
  serverErrorResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const orders = await getAdminOrders();
    return NextResponse.json({ orders });
  } catch (error) {
    return serverErrorResponse(error, "ADMIN_ORDERS_READ_FAILED");
  }
}
