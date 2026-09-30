import { NextResponse } from "next/server";
import {
  consumePasswordReset,
  domainErrorResponse,
  passwordResetConfirmSchema,
  serverErrorResponse,
  validationResponse,
} from "@/lib/server/passwordReset";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = passwordResetConfirmSchema.parse(await request.json());
    await consumePasswordReset(payload.token, payload.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    const domain = domainErrorResponse(error);
    if (domain) return domain;
    return serverErrorResponse(error, "PASSWORD_RESET_CONFIRM_FAILED");
  }
}
