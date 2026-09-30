import { NextResponse } from "next/server";
import {
  passwordResetRequestSchema,
  requestPasswordReset,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/passwordReset";
import { passwordResetIdentifierLimiter, passwordResetIpLimiter } from "@/lib/server/rateLimit";
import { getClientIp } from "@/lib/server/requestIp";

export const runtime = "nodejs";

// Always the exact same success response, regardless of whether the account
// exists, is withdrawn, or the second factor matched — this is the entire
// point of the endpoint (see requestPasswordReset in passwordReset.ts). Never
// add a branch here that varies the response based on what
// requestPasswordReset actually did.
const GENERIC_RESPONSE = {
  message: "요청이 접수되었습니다. 입력하신 정보가 확인되면 담당자가 연락드립니다.",
};

export async function POST(request: Request) {
  let payload: { loginId: string; businessRegNumber: string };
  try {
    payload = passwordResetRequestSchema.parse(await request.json());
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "PASSWORD_RESET_REQUEST_FAILED");
  }

  const ip = getClientIp(request.headers);
  const identifierKey = `password-reset:${payload.loginId}`;
  // getClientIp returns null when it can't determine a trustworthy IP (see
  // requestIp.ts) — effectively local-dev-only behind Render's proxy in
  // production. Skip only the IP axis then; the identifier axis still
  // applies regardless, same pattern as auth.ts's login limiter.
  const ipKey = ip !== null ? `password-reset-ip:${ip}` : null;

  // Same two-axis check-before-work shape as login (see auth.ts) — this also
  // means a blocked caller gets a 429 without us ever touching the DB, which
  // doubles as one more brute-force-cost limiter on top of the rate limit
  // itself.
  if (
    passwordResetIdentifierLimiter.isBlocked(identifierKey) ||
    (ipKey !== null && passwordResetIpLimiter.isBlocked(ipKey))
  ) {
    return NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
  }
  // Record every attempt regardless of outcome — like login, and like
  // signup's flood limiter, the thing being capped is attempt volume, not
  // "failures" (there's no way to define failure here without leaking
  // whether the account exists).
  passwordResetIdentifierLimiter.record(identifierKey);
  if (ipKey !== null) passwordResetIpLimiter.record(ipKey);

  try {
    await requestPasswordReset(payload.loginId, payload.businessRegNumber);
  } catch (error) {
    // Even on an unexpected internal error, don't let the response shape
    // differ in a way that leaks account existence beyond "the server had a
    // problem" — log server-side, still return something generic.
    console.error("PASSWORD_RESET_REQUEST_FAILED", error);
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
