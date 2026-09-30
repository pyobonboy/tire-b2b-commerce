import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createInquiry,
  createInquirySchema,
  domainErrorResponse,
  getMyInquiries,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/inquiry";
import { inquiryCreateLimiter } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

// Any signed-in role can ask (mirrors CustomerContent gating the 1:1 tab on
// "logged in", not on a specific role) — matches wishlist.ts's
// AUTHENTICATED_ROLES convention.
const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

// GET returns only the caller's own inquiries — see getMyInquiries in
// inquiry.ts for why that's the entire mechanism keeping one user from
// reading another's. `listingIds` (comma-separated) narrows to the product
// detail page's "내 상품 문의" block; omitted, it's the customer page's full
// "나의 문의 내역" list.
export async function GET(request: Request) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const raw = url.searchParams.get("listingIds");
    const listingIds = raw
      ? raw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    const inquiries = await getMyInquiries(auth.session.user.id, listingIds);
    return NextResponse.json({ inquiries });
  } catch (error) {
    return serverErrorResponse(error, "INQUIRY_LIST_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  // Unauthenticated flood isn't the risk here (requireRole already blocks
  // that) — an authenticated user spamming the support queue still is. See
  // inquiryCreateLimiter's comment in rateLimit.ts.
  const rateLimitKey = `inquiry:${auth.session.user.id}`;
  if (inquiryCreateLimiter.isBlocked(rateLimitKey)) {
    return NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
  }
  // Count every submission attempt, not just failed ones — the thing being
  // capped is volume, same as signupIpLimiter.
  inquiryCreateLimiter.record(rateLimitKey);

  try {
    const payload = createInquirySchema.parse(await request.json());
    const inquiry = await createInquiry(auth.session.user.id, payload);
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "INQUIRY_CREATE_FAILED");
  }
}
