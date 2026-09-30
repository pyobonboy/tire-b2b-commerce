import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { getCheckoutShippingSummary } from "@/lib/server/checkout";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const groups = await getCheckoutShippingSummary(auth.session.user.id);
    return NextResponse.json({ groups });
  } catch (error) {
    console.error("CHECKOUT_SUMMARY_READ_FAILED", error);
    return NextResponse.json({ error: "CHECKOUT_SUMMARY_READ_FAILED" }, { status: 500 });
  }
}
