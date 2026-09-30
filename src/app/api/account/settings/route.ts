import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  accountPatchSchema,
  domainErrorResponse,
  getAccountProfile,
  serverErrorResponse,
  updateAccountProfile,
  validationResponse,
} from "@/lib/server/account";

export const runtime = "nodejs";

const AUTHENTICATED_ROLES = ["BUYER", "SELLER", "ADMIN"] as const;

export async function GET() {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({ profile: await getAccountProfile(auth.session.user.id) });
  } catch (error) {
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "ACCOUNT_PROFILE_READ_FAILED");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireRole(AUTHENTICATED_ROLES);
  if (auth.response) return auth.response;

  try {
    const payload = accountPatchSchema.parse(await request.json());
    return NextResponse.json({ profile: await updateAccountProfile(auth.session.user.id, payload) });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "ACCOUNT_PROFILE_UPDATE_FAILED");
  }
}
