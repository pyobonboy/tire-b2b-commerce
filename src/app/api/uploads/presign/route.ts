import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/guard";
import {
  createImagePresign,
  imagePresignSchema,
  MAX_IMAGE_BYTES,
  StorageConfigurationError,
} from "@/lib/server/storage";
import { z } from "zod";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireRole(["SELLER", "ADMIN"]);
  if (auth.response) return auth.response;

  try {
    const payload = imagePresignSchema.parse(await request.json());
    const result = await createImagePresign(auth.session.user.id, payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "VALIDATION_ERROR",
          details: error.issues,
          maxBytes: MAX_IMAGE_BYTES,
        },
        { status: 400 },
      );
    }
    if (error instanceof StorageConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("IMAGE_PRESIGN_FAILED", error);
    return NextResponse.json({ error: "IMAGE_PRESIGN_FAILED" }, { status: 500 });
  }
}
