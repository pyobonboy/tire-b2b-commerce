import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

// Both signup routes previously fell through a shared serverErrorResponse
// (in seller.ts) that collapsed every Prisma P2002 unique-violation into one
// undifferentiated { error: "DUPLICATE_RESOURCE" } — which loginId, which
// 사업자등록번호, or (seller only) which 판매자 코드 caused it was
// indistinguishable, so the signup pages could only ever show a generic
// "already in use" message. This helper is deliberately separate from
// seller.ts's serverErrorResponse (owned by another task in this wave —
// listing/order routes still rely on its exact current behavior) so both
// signup routes can call it FIRST and get a field-specific response, falling
// back to the shared helper only for non-P2002 errors.
const DUPLICATE_FIELD_MESSAGES: Record<string, string> = {
  loginId: "이미 사용 중인 아이디입니다.",
  businessRegNumber: "이미 등록된 사업자등록번호입니다.",
  code: "이미 사용 중인 판매자 코드입니다.",
};

/**
 * Returns a field-specific 409 response if `error` is a Prisma unique-
 * constraint violation on a column we recognize, or null otherwise (in which
 * case the caller should fall back to its normal error handling).
 */
export function duplicateSignupFieldResponse(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }

  const target = error.meta?.target;
  const columns = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  const field = columns.find((column) => column in DUPLICATE_FIELD_MESSAGES) ?? null;

  return NextResponse.json(
    {
      error: "DUPLICATE_RESOURCE",
      field,
      message: field ? DUPLICATE_FIELD_MESSAGES[field] : "이미 사용 중인 정보가 있습니다.",
    },
    { status: 409 },
  );
}
