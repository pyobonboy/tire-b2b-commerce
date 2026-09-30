import { NextResponse } from "next/server";
import {
  adminShippingSchema,
  requireAdmin,
  serverErrorResponse,
  updateAdminShipping,
  validationResponse,
} from "@/lib/server/admin";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = adminShippingSchema.parse(await request.json());
    const result = await updateAdminShipping(id, auth.adminId, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ order: result.order });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_SHIPPING_OVERRIDE_FAILED");
  }
}
