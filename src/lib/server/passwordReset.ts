import { randomBytes, createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeBusinessRegNumber } from "@/lib/business-reg-number";
import { prisma } from "./prisma";

// ============================================================================
// 비밀번호 재설정 (password reset) — operator-mediated design
// ============================================================================
//
// There is no email or SMS provider configured for this deployment, and none
// is available. A forgotten password otherwise has zero recovery path short
// of an operator hand-editing the database, which is the problem this module
// exists to fix — without inventing a delivery channel that doesn't exist.
//
// The flow:
//   1. POST /api/account/password-reset/request (public, unauthenticated):
//      given a loginId + businessRegNumber (the second factor — see the
//      comment on requestPasswordReset for why this pair), creates a
//      one-time token IF the account exists, is active, and the second
//      factor matches. The HTTP response is IDENTICAL either way (see the
//      route) — this function's job is only to do the work, never to signal
//      back whether anything actually happened.
//   2. The raw token is logged to the server console, but ONLY outside
//      production (`NODE_ENV !== "production"`) — a developer's own local/
//      staging convenience, never a production delivery mechanism.
//   3. In production, the only way to hand the token to the verified
//      business is through mintPasswordResetTokenForAdmin below: an
//      ADMIN-authenticated endpoint that mints a FRESH token and returns the
//      raw value directly in that (authenticated) response, for the admin to
//      read to the caller over the phone after verifying them by some
//      out-of-band means. This is deliberately the only place the raw token
//      is ever returned over HTTP — see the loud warning on that function.
//   4. POST /api/account/password-reset/confirm (public): token + new
//      password → password changed, token (and every other outstanding token
//      for that user) invalidated.
//
// Why only a hash is ever stored: identical reasoning to storing
// passwordHash instead of a plaintext password — a stolen row from this
// table must not, by itself, let someone take over the account. The
// consequence (documented where it matters, on listOutstandingPasswordReset
// Requests and mintPasswordResetTokenForAdmin) is that the admin "queue"
// screen can show WHICH accounts have a pending request, but never the
// secret itself unless a *new* token is minted through the admin action.
//
// ⚠️ REPLACE THIS THE MOMENT A REAL DELIVERY CHANNEL EXISTS ⚠️
// The moment this service has a real SMS/email provider, requestPasswordReset
// should deliver the token directly to the user, and the admin-mint escape
// hatch (and the console-log fallback) should be deleted outright — a human
// operator relaying a secret by phone is a stopgap, not a feature.
//
// 아이디 찾기 (find login ID) is a separate, simpler concern — see findId.ts.

const RAW_TOKEN_BYTES = 32; // 256-bit token — see hashToken() for why sha256
// (not bcrypt) is the right hash for this value specifically.
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes: long enough for an operator
// to call back the verified business, short enough that a logged/relayed
// token still expires reasonably quickly if nothing happens with it.

export const passwordResetRequestSchema = z.object({
  loginId: z.string().trim().min(1).max(40),
  // Second identifying factor. businessRegNumber (not mobilePhone) was
  // chosen because: (a) it is already validated to a strict 10-digit
  // checksummed format (business-reg-number.ts), so a submitted value that
  // merely "looks plausible" doesn't get free attempts the way an
  // unconstrained phone number would; (b) it is the same identifier this
  // wave adds a uniqueness/format guarantee for, so this endpoint doubles as
  // a place that benefits from that work. Note this is NOT a strong secret —
  // 사업자등록번호 is often printed on invoices/storefronts — the real
  // security boundary in this flow is the operator's out-of-band phone
  // verification before handing out a token, not this check. This check
  // exists to stop trivial "try every loginId" enumeration, not to replace
  // human verification.
  businessRegNumber: z.string().trim().min(1).max(40),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(1),
  // Same rule as signup (buyerSignupSchema/sellerSignupSchema).
  password: z.string().min(8).max(100),
});

export const adminMintPasswordResetSchema = z.object({
  loginId: z.string().trim().min(1).max(40),
});

export class PasswordResetDomainError extends Error {
  constructor(
    public readonly code: "INVALID_OR_EXPIRED_TOKEN" | "ACCOUNT_NOT_FOUND",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "PasswordResetDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof PasswordResetDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function generateRawToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString("hex");
}

function hashToken(rawToken: string): string {
  // sha256 (not bcrypt) is the right tool here: bcrypt's slow, salted KDF
  // exists to resist offline guessing of a low-entropy, human-memorable
  // secret (a password). This token is a 256-bit cryptographically random
  // value with no guessable structure — a fast general-purpose hash already
  // makes recovering it from a stolen tokenHash infeasible, while keeping the
  // consume-time lookup a cheap indexed equality check instead of a
  // deliberately-slow one.
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Invalidate any outstanding token for `userId` and issue a fresh one.
 * Shared by the self-service request path and the admin-mint path so both
 * follow the same "at most one live token per user" invariant. */
async function issueTokenForUser(userId: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(rawToken), expiresAt },
    }),
  ]);

  return { rawToken, expiresAt };
}

/**
 * Always resolves the same way regardless of whether the account exists,
 * is withdrawn, or the second factor matches — callers (the request route)
 * MUST NOT branch the HTTP response on anything but rate-limit state, or
 * this stops being non-enumerable. See the request route for the actual
 * (identical-either-way) response.
 */
export async function requestPasswordReset(loginId: string, businessRegNumber: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { loginId },
    select: { id: true, businessRegNumber: true, withdrawnAt: true },
  });
  if (!user || user.withdrawnAt) return;
  if (normalizeBusinessRegNumber(user.businessRegNumber) !== normalizeBusinessRegNumber(businessRegNumber)) {
    return;
  }

  const { rawToken, expiresAt } = await issueTokenForUser(user.id);

  // ⚠️ TEMPORARY, DEV-ONLY DELIVERY CHANNEL — see the module doc comment.
  // Never runs in production; production has no way to see this value here
  // at all (by design — see mintPasswordResetTokenForAdmin instead).
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[password-reset][dev-only] token for loginId=${loginId}: ${rawToken} (expires ${expiresAt.toISOString()})`,
    );
  }
}

/**
 * token + new password → password changed. Single-use: this token (and any
 * other outstanding token for the same user) is invalidated in the same
 * transaction that changes the password, so a leaked/logged token that
 * already got used can't be replayed.
 */
export async function consumePasswordReset(rawToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.consumedAt || record.expiresAt <= now) {
    throw new PasswordResetDomainError("INVALID_OR_EXPIRED_TOKEN");
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { withdrawnAt: true } });
  if (!user || user.withdrawnAt) {
    throw new PasswordResetDomainError("INVALID_OR_EXPIRED_TOKEN");
  }

  // Hash before opening the transaction — bcrypt's cost factor makes this
  // the slow step, and it doesn't need a DB transaction held open around it
  // (same reasoning as createBuyerApplication/createSellerApplication).
  const passwordHash = await hash(newPassword, 10);

  const consumed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Conditional update as a compare-and-swap guard: if two requests race
    // to redeem the same token, only the first one finds it still
    // `consumedAt: null` here and actually changes the password.
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claim.count === 0) return false;

    // passwordChangedAt is what actually signs out sessions that already
    // exist: getSession() (src/lib/server/auth.ts) rejects any JWT issued
    // before this instant. Without it a reset would change the password
    // while leaving an intruder's session alive for the rest of its 8 hours.
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    // Invalidate every other outstanding token for this user too, not just
    // the one just redeemed.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return true;
  });

  if (!consumed) throw new PasswordResetDomainError("INVALID_OR_EXPIRED_TOKEN");
}

export interface OutstandingPasswordResetRequest {
  id: string;
  loginId: string;
  businessName: string;
  mobilePhone: string;
  requestedAt: string;
  expiresAt: string;
}

/**
 * ADMIN-only visibility into pending requests. Deliberately does NOT (cannot)
 * include the raw token — only tokenHash is ever stored (see the module doc
 * comment). This is a triage/audit list ("these businesses are waiting on a
 * callback"), not the token-relay mechanism itself; use
 * mintPasswordResetTokenForAdmin for that.
 */
export async function listOutstandingPasswordResetRequests(): Promise<OutstandingPasswordResetRequest[]> {
  const records = await prisma.passwordResetToken.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { loginId: true, businessName: true, mobilePhone: true } } },
  });

  return records.map((record) => ({
    id: record.id,
    loginId: record.user.loginId,
    businessName: record.user.businessName,
    mobilePhone: record.user.mobilePhone,
    requestedAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  }));
}

/**
 * Mints a brand-new token for `loginId` and returns the RAW value directly in
 * the result — the one and only place in this module that happens.
 *
 * This is safe ONLY because the caller (the admin route) already required
 * requireRole(["ADMIN"]) before reaching here: the token is being handed to
 * an authenticated staff member, not to the public/unauthenticated requester
 * that hit the /request endpoint. The admin is expected to have already
 * verified the caller out-of-band (by phone, against the business details on
 * file) before reading this value out to them — that verification step,
 * not this function, is the actual security control in this flow.
 */
export async function mintPasswordResetTokenForAdmin(
  loginId: string,
): Promise<{ token: string; loginId: string; expiresAt: string }> {
  const user = await prisma.user.findUnique({ where: { loginId }, select: { id: true, withdrawnAt: true } });
  if (!user || user.withdrawnAt) {
    throw new PasswordResetDomainError("ACCOUNT_NOT_FOUND", 404);
  }

  const { rawToken, expiresAt } = await issueTokenForUser(user.id);
  return { token: rawToken, loginId, expiresAt: expiresAt.toISOString() };
}
