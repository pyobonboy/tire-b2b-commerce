import type { NextRequest } from "next/server";
import { getPublicCatalogPage, isCatalogSortKey } from "@/lib/server/products";
import { getSession } from "@/lib/server/auth";

export const runtime = "nodejs";

// Kept in sync with PAGE_SIZE in src/app/products/page.tsx: the client uses
// the same number to compute how many pages `total` implies. It can't be
// imported from here — this module pulls in the Prisma client, which must
// never end up in a "use client" bundle.
const PAGE_SIZE = 12;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const sortParam = params.get("sort");
    const sort = isCatalogSortKey(sortParam) ? sortParam : "registered";

    const pageParam = Number(params.get("page"));
    const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

    // Route stays public (product spec/DOT/images/reviews are meant to be
    // visible to visitors) — only the wholesale-price-adjacent fields are
    // gated, and that gating happens inside getPublicCatalogPage/toCatalogRows,
    // not by a 401 here. See the SECURITY BOUNDARY comment in
    // src/lib/server/products.ts.
    const session = await getSession();

    const { rows, total } = await getPublicCatalogPage(
      {
        size: params.get("size") ?? undefined,
        manufacturer: params.get("manufacturer") || undefined,
        model: params.get("model") || undefined,
        productCode: params.get("productCode") || undefined,
        width: params.get("width") || undefined,
        ratio: params.get("ratio") || undefined,
        rim: params.get("rim") || undefined,
        dot: params.get("dot") || undefined,
        tag: params.get("tag") || undefined,
      },
      sort,
      page,
      PAGE_SIZE,
      { includeSensitive: Boolean(session) },
    );

    return Response.json({ products: rows, total });
  } catch (error) {
    console.error("Failed to load public products", error);
    return Response.json({ error: "PRODUCTS_UNAVAILABLE" }, { status: 500 });
  }
}
