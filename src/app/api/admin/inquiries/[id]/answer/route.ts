import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin";
import { answerInquiry, answerInquirySchema, serverErrorResponse, validationResponse } from "@/lib/server/inquiry";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const payload = answerInquirySchema.parse(await request.json());
    const result = await answerInquiry(id, auth.adminId, payload);
    if (result.kind === "NOT_FOUND") {
      return NextResponse.json({ error: "INQUIRY_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ inquiry: result.inquiry });
  } catch (error) {
    const invalid = validationResponse(error);
    if (invalid) return invalid;
    return serverErrorResponse(error, "ADMIN_INQUIRY_ANSWER_FAILED");
  }
}
