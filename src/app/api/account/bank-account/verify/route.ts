import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  bankAccountSchema,
  domainErrorResponse,
  saveBankAccount,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/account";

export const runtime = "nodejs";

const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function POST(request: Request) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const payload = bankAccountSchema.parse(await request.json());
    const { profile, verification } = await saveBankAccount(auth.session.user.id, payload);
    // This route is named `verify` for the eventual real 실명조회 integration
    // (see bankVerification.ts), but today it never performs one — respond
    // honestly: always report unverified/pending, driven by what the
    // (currently "not configured") provider actually returned rather than a
    // hard-coded literal, so this stays correct the moment a real provider is
    // swapped in.
    return NextResponse.json({
      profile,
      verified: verification.verified,
      status: verification.verified ? "VERIFIED" : "PENDING_ADMIN_REVIEW",
      reason: verification.reason,
    });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "BANK_ACCOUNT_SAVE_FAILED");
  }
}
