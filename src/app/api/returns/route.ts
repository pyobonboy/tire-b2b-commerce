import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createReturnRequest,
  createReturnRequestSchema,
  domainErrorResponse,
  getBuyerReturnRequests,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/returns";

export const runtime = "nodejs";

// GET: the signed-in buyer's own requests — /mypage/returns.
export async function GET() {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const returnRequests = await getBuyerReturnRequests(auth.session.user.id);
    return NextResponse.json({ returnRequests });
  } catch (error) {
    return serverErrorResponse(error, "BUYER_RETURN_REQUESTS_READ_FAILED");
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  try {
    const payload = createReturnRequestSchema.parse(await request.json());
    const returnRequest = await createReturnRequest(auth.session.user.id, payload);
    return NextResponse.json({ returnRequest }, { status: 201 });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "RETURN_REQUEST_CREATE_FAILED");
  }
}
