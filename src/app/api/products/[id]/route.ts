import type { NextRequest } from "next/server";
import { getPublicProduct, toProductView } from "@/lib/server/products";
import { getSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const product = await getPublicProduct(id);

    if (!product) {
      return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    // Route stays public — only the wholesale-price-adjacent fields are
    // gated inside toProductView/toSeller, not by a 401 here. See the
    // SECURITY BOUNDARY comment in src/lib/server/products.ts.
    const session = await getSession();
    const view = toProductView(product, request.nextUrl.searchParams.get("dot"), {
      includeSensitive: Boolean(session),
    });
    if (!view) {
      return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    return Response.json({ product: view });
  } catch (error) {
    console.error("Failed to load public product", error);
    return Response.json({ error: "PRODUCT_UNAVAILABLE" }, { status: 500 });
  }
}
