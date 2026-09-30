import { NextResponse } from "next/server";
import { requireSeller } from "@/lib/server/seller";
import { getSellerReturnRequests, serverErrorResponse } from "@/lib/server/returns";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireSeller();
  if (auth.response) return auth.response;

  try {
    const returnRequests = await getSellerReturnRequests(auth.sellerId);
    return NextResponse.json({ returnRequests });
  } catch (error) {
    return serverErrorResponse(error, "SELLER_RETURN_REQUESTS_READ_FAILED");
  }
}
