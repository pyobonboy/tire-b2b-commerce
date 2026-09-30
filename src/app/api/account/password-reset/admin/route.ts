import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  adminMintPasswordResetSchema,
  domainErrorResponse,
  listOutstandingPasswordResetRequests,
  mintPasswordResetTokenForAdmin,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/passwordReset";

export const runtime = "nodejs";

// Deliberately NOT under src/app/api/admin/** (owned by another task in this
// wave) — this is its own small, self-contained admin-only surface for the
// account-recovery stopgap described in passwordReset.ts.

/** List pending requests so an operator knows who's waiting on a callback.
 * Never includes the raw token — only its hash is ever stored. Use POST to
 * mint a fresh, revealable token once the caller has been verified by phone. */
export async function GET() {
  const auth = await requireRole(["ADMIN"]);
  if (auth.response) return auth.response;

  try {
    const requests = await listOutstandingPasswordResetRequests();
    return NextResponse.json({ requests });
  } catch (error) {
    return serverErrorResponse(error, "PASSWORD_RESET_ADMIN_LIST_FAILED");
  }
}

/**
 * Mints a fresh token for the given loginId and returns the raw value
 * directly in this response. Safe ONLY because requireRole(["ADMIN"]) above
 * has already authenticated the caller as staff — see the loud warning on
 * mintPasswordResetTokenForAdmin in passwordReset.ts. The operator is
 * expected to have verified the business by phone before calling this, and
 * to read the returned token back to them over that same call — this
 * endpoint has no other way to deliver it.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["ADMIN"]);
  if (auth.response) return auth.response;

  try {
    const payload = adminMintPasswordResetSchema.parse(await request.json());
    const result = await mintPasswordResetTokenForAdmin(payload.loginId);
    return NextResponse.json(result);
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "PASSWORD_RESET_ADMIN_MINT_FAILED");
  }
}
