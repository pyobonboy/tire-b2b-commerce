import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBusinessRegNumber } from "@/lib/business-reg-number";
import { prisma } from "./prisma";

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

// 아이디 찾기 — same "no delivery channel, must not be enumerable" constraint
// as password reset (see passwordReset.ts), but a fundamentally different
// answer: a loginId is not, by itself, a secret that grants access — the
// password is still required to log in — so unlike a reset token it's safe
// to hand back directly instead of routing through an operator. What still
// needs protecting is account existence: without a check, this endpoint
// would let anyone confirm "a business with 사업자등록번호 X has an account
// here" just by submitting it. Requiring a SECOND fact (the mobile number on
// file) before revealing anything, and masking what's revealed, keeps this
// endpoint from being a plain existence-checker while still being useful to
// someone who has genuinely forgotten their own login ID.
export const findIdRequestSchema = z.object({
  businessRegNumber: z.string().trim().min(1).max(40),
  mobilePhone: z.string().trim().min(1).max(30),
});

/** first two chars + last char visible, everything between masked — enough
 * for the account owner to recognize their own ID, not enough to hand
 * someone else a usable credential. */
function maskLoginId(loginId: string): string {
  if (loginId.length <= 2) {
    return `${loginId.slice(0, 1)}${"*".repeat(Math.max(loginId.length - 1, 1))}`;
  }
  const visibleStart = loginId.slice(0, 2);
  const visibleEnd = loginId.slice(-1);
  const maskedLength = Math.max(loginId.length - 3, 1);
  return `${visibleStart}${"*".repeat(maskedLength)}${visibleEnd}`;
}

/**
 * Returns the masked loginId if businessRegNumber + mobilePhone both match an
 * active (non-withdrawn) account, or null otherwise. The route always
 * returns the same JSON shape either way ({ maskedLoginId }) — only its
 * value differs — so a wrong guess and "no such account" look identical
 * apart from that one field, which is unavoidable given the feature's whole
 * point is to reveal that field on a correct guess.
 */
export async function findMaskedLoginId(
  businessRegNumber: string,
  mobilePhone: string,
): Promise<string | null> {
  const normalizedRegNumber = normalizeBusinessRegNumber(businessRegNumber);
  const normalizedPhone = mobilePhone.trim();
  if (!normalizedRegNumber || !normalizedPhone) return null;

  // businessRegNumber is @unique (see schema.prisma), so this can match at
  // most one row.
  const user = await prisma.user.findUnique({
    where: { businessRegNumber: normalizedRegNumber },
    select: { loginId: true, mobilePhone: true, withdrawnAt: true },
  });
  if (!user || user.withdrawnAt) return null;
  if (user.mobilePhone !== normalizedPhone) return null;

  return maskLoginId(user.loginId);
}
