import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import { getSettlementView, serverErrorResponse } from "@/lib/server/settlement";

export const runtime = "nodejs";

// Every authenticated role can hit this route — SELLER/ADMIN sessions just
// get back the NOT_APPLICABLE scope (see getSettlementView) instead of a
// 403, since the three mypage screens that read this today are reachable by
// any signed-in role and need an honest "why is this empty" answer rather
// than a hard block.
const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function GET() {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const settlement = await getSettlementView(auth.session.user.id, auth.session.user.role);
    return NextResponse.json({ settlement });
  } catch (error) {
    return serverErrorResponse(error, "SETTLEMENT_READ_FAILED");
  }
}
