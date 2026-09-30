import { NextResponse } from "next/server";
import {
  findIdRequestSchema,
  findMaskedLoginId,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/findId";
import { findIdIdentifierLimiter, findIdIpLimiter } from "@/lib/server/rateLimit";
import { getClientIp } from "@/lib/server/requestIp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: { businessRegNumber: string; mobilePhone: string };
  try {
    payload = findIdRequestSchema.parse(await request.json());
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "FIND_ID_FAILED");
  }

  const ip = getClientIp(request.headers);
  const identifierKey = `find-id:${payload.businessRegNumber}`;
  // getClientIp returns null when it can't determine a trustworthy IP (see
  // requestIp.ts) — effectively local-dev-only behind Render's proxy in
  // production. Skip only the IP axis then; the identifier axis still
  // applies regardless, same pattern as auth.ts's login limiter.
  const ipKey = ip !== null ? `find-id-ip:${ip}` : null;

  if (findIdIdentifierLimiter.isBlocked(identifierKey) || (ipKey !== null && findIdIpLimiter.isBlocked(ipKey))) {
    return NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
  }
  findIdIdentifierLimiter.record(identifierKey);
  if (ipKey !== null) findIdIpLimiter.record(ipKey);

  try {
    const maskedLoginId = await findMaskedLoginId(payload.businessRegNumber, payload.mobilePhone);
    // Same JSON shape either way — only the value of maskedLoginId differs —
    // see findId.ts for why that's an acceptable (not perfectly zero-
    // knowledge) trade-off for this specific feature.
    return NextResponse.json({ maskedLoginId });
  } catch (error) {
    return serverErrorResponse(error, "FIND_ID_FAILED");
  }
}
