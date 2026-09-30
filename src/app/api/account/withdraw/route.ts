import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  domainErrorResponse,
  serverErrorResponse,
  withdrawAccount,
} from "@/lib/server/account";

export const runtime = "nodejs";

const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function POST() {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const result = await withdrawAccount(
      auth.session.user.id,
      auth.session.user.role,
      auth.session.user.sellerId,
    );
    return NextResponse.json(result);
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "ACCOUNT_WITHDRAW_FAILED");
  }
}
