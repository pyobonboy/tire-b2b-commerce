import type { CatalogRow, Manufacturer } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { parseTireSize } from "@/lib/tireSearch";
import { prisma } from "./prisma";

const publicListingSelect = {
  id: true,
  dot: true,
  loadIndex: true,
  speedIndex: true,
  ply: true,
  season: true,
  productCode: true,
  discountRate: true,
  price: true,
  factoryPrice: true,
  stock: true,
  minOrder: true,
  tag: true,
  createdAt: true,
  seller: {
    select: {
      code: true,
      courier: true,
      shippingNote: true,
      shippingFee: true,
      freeShippingThreshold: true,
    },
  },
  images: {
    orderBy: { sortOrder: "asc" },
    select: { url: true },
  },
} satisfies Prisma.ListingSelect;

// A suspended or withdrawn seller can no longer log in to ship orders (see
// requireSeller's SELLER_INACTIVE check), so their listings must not appear
// as purchasable in the public catalog even while the listing row itself is
// still ACTIVE.
const activeListingWhere = {
  status: "ACTIVE",
  seller: { status: "ACTIVE", user: { withdrawnAt: null } },
} satisfies Prisma.ListingWhereInput;

const publicProductSelect = {
  id: true,
  manufacturer: true,
  model: true,
  width: true,
  ratio: true,
  rim: true,
  createdAt: true,
  listings: {
    where: activeListingWhere,
    orderBy: [{ createdAt: "asc" }, { price: "asc" }],
    select: publicListingSelect,
  },
} satisfies Prisma.ProductSelect;

export async function getPublicProduct(id: string) {
  return prisma.product.findFirst({
    where: { id, listings: { some: activeListingWhere } },
    select: publicProductSelect,
  });
}

type PublicProduct = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;
type PublicListing = PublicProduct["listings"][number];

function groupByDot(listings: readonly PublicListing[]) {
  const groups = new Map<string, PublicListing[]>();
  for (const listing of listings) {
    const group = groups.get(listing.dot) ?? [];
    group.push(listing);
    groups.set(listing.dot, group);
  }
  return groups;
}

// SECURITY BOUNDARY: the "로그인 후 공개" gate in the product list/detail UI
// (src/app/products/page.tsx, src/app/products/[id]/page.tsx) is display-only
// — it hides sensitive fields with CSS/conditional rendering, nothing more.
// The actual enforcement is here: `includeSensitive` decides whether a
// listing's wholesale-price-adjacent fields ever leave the server. When you
// add a new field to a public view below, decide right here whether it's
// sensitive (B2B price/stock info a suspended buyer signup is meant to keep
// out) or safe to always return (spec/DOT/images/etc — intended to be public
// so visitors have a reason to sign up).
//
// Sensitive fields, nulled (never 0 — 0 would read as a real "0원" price) for
// anonymous requests: price, factoryPrice, lowPrice, highPrice, discountRate,
// stock, minOrder.

function toSeller(listing: PublicListing, { includeSensitive }: { includeSensitive: boolean }) {
  return {
    id: listing.id,
    code: listing.seller.code,
    discountRate: includeSensitive ? Number(listing.discountRate) : null,
    price: includeSensitive ? listing.price : null,
    stock: includeSensitive ? listing.stock : null,
    minOrder: includeSensitive ? listing.minOrder : null,
    shippingNote: listing.seller.shippingNote ?? "",
    courier: listing.seller.courier,
    // QA 발견: 판매점 비교 화면이 택배사·배송메모는 보여주면서 정작 배송비
    // 금액과 무료배송 기준은 장바구니에 담기 전까지 알 수 없었다. 구매자가
    // 판매점을 고르는 화면이므로 가격 비교에 배송비도 필요하다.
    // (Not in the sensitive list above — it's shipping policy, not B2B
    // pricing, and the comparison table needs it regardless of session.)
    shippingFee: listing.seller.shippingFee,
    freeShippingThreshold: listing.seller.freeShippingThreshold,
    images: listing.images.map((image) => image.url),
  };
}

export function toProductView(
  product: PublicProduct,
  requestedDot: string | null,
  { includeSensitive }: { includeSensitive: boolean },
) {
  const groups = groupByDot(product.listings);
  const fallbackDot = groups.keys().next().value;
  const dot = requestedDot && groups.has(requestedDot) ? requestedDot : fallbackDot;
  const listings = dot ? groups.get(dot) ?? [] : [];
  const first = listings[0];

  if (!first || !dot) return null;

  return {
    id: product.id,
    manufacturer: product.manufacturer as Manufacturer,
    model: product.model,
    width: product.width,
    ratio: product.ratio,
    rim: product.rim,
    dot,
    factoryPrice: includeSensitive ? first.factoryPrice : null,
    spec: {
      loadIndex: first.loadIndex,
      speedIndex: first.speedIndex,
      ply: first.ply,
      origin: "-",
      season: first.season,
      productCode: first.productCode,
    },
    // Sort by the real (never-nulled) price so guests still see sellers
    // ordered cheapest-first even though the price itself is hidden from them.
    sellers: [...listings]
      .sort((a, b) => a.price - b.price)
      .map((listing) => toSeller(listing, { includeSensitive })),
  };
}

// ---------------------------------------------------------------------------
// Public catalog listing: server-side filter/sort/page
// ---------------------------------------------------------------------------
//
// A CatalogRow is not a row in any table: toCatalogRow (the old client-side
// helper this replaces) expanded each Product into one row per distinct DOT
// across its *active* listings, aggregating lowPrice/highPrice/stock/
// discountRate across the listings that share that DOT. That means a
// "cheapest first" page has to be ordered by the per-(product, dot) minimum
// price, and a page of 12 rows has to be sliced *after* that aggregation and
// grouping — not by paging over Product or Listing directly. Prisma's query
// builder can express the join and the filters, but it can't express
// "GROUP BY product+dot, aggregate, then also pick one representative
// listing's non-aggregated fields (spec/productCode/factoryPrice/tag) per
// group, ORDER BY an aggregate, and LIMIT/OFFSET the groups" in a single
// round trip — `groupBy` returns aggregates only, with no way to also select
// arbitrary per-group columns or order by anything but the grouped/aggregated
// fields it returns, and there is no supported way to join a `groupBy` result
// back to full rows and page over the joined set. Doing this with the
// generated client would mean pulling every matching listing into Node and
// grouping/sorting/paging in memory — exactly the unbounded-download problem
// this change exists to fix. Raw SQL is therefore used here, with every
// filter value passed as a bound parameter (never string-interpolated) so
// user input can't reach the query text.
type CatalogSortKey = "registered" | "popular" | "lowest" | "highest" | "discount";

const CATALOG_SORT_KEYS: readonly CatalogSortKey[] = [
  "registered",
  "popular",
  "lowest",
  "highest",
  "discount",
];

export function isCatalogSortKey(value: string | null): value is CatalogSortKey {
  return !!value && (CATALOG_SORT_KEYS as readonly string[]).includes(value);
}

export interface CatalogFilters {
  // Raw, un-trimmed search-box value; parsed internally with parseTireSize.
  size?: string;
  manufacturer?: string;
  model?: string;
  productCode?: string;
  // Kept as raw strings (not pre-parsed to number) so this function can
  // reproduce the previous client behaviour exactly: a non-numeric value in
  // one of these fields must yield zero rows, not "filter ignored".
  width?: string;
  ratio?: string;
  rim?: string;
  dot?: string;
  tag?: string;
}

export interface CatalogPage {
  rows: CatalogRow[];
  total: number;
}

// Escapes the characters ILIKE treats specially so a substring search never
// behaves like a pattern/regex when the user types e.g. "50%_off". Postgres's
// default LIKE/ILIKE escape character is a literal backslash, so escaping
// here (and passing the result as a bound parameter) is enough — no ESCAPE
// clause needed.
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

// Builds `column = <n>` when raw parses to a finite number, or a condition
// that can never match when it doesn't — mirroring the old client filter
// `r.width !== Number(width)`, where a non-numeric input compares against
// NaN and therefore excludes every row (not "no filter applied").
function exactNumberCondition(column: Prisma.Sql, raw: string | undefined): Prisma.Sql | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Prisma.sql`${column} = ${value}` : Prisma.sql`false`;
}

// Prisma's raw-query result typing for Decimal/bigint columns isn't a plain
// JS number — normalise via toString() so it works regardless of whether the
// driver handed back a Decimal instance, a numeric string, or a number.
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return Number(String(value));
}

interface CatalogQueryRow {
  product_id: string;
  manufacturer: string;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  product_created_at: Date | string;
  dot: string;
  load_index: string;
  speed_index: string;
  ply: string;
  season: string;
  product_code: string;
  factory_price: number;
  low_price: number;
  high_price: number;
  total_stock: number;
  max_discount_rate: unknown;
  tag: string | null;
}

interface ProductDotCountRow {
  product_id: string;
  dot_count: number;
}

// See the SECURITY BOUNDARY comment above toSeller/toProductView — same rule
// applies here: sort/filter/paginate on the real (never-nulled) values (done
// above, in SQL, before this runs), then null the sensitive fields only in
// this final shaping step for anonymous callers.
function toCatalogRows(
  rows: readonly CatalogQueryRow[],
  dotCounts: ReadonlyMap<string, number>,
  { includeSensitive }: { includeSensitive: boolean },
): CatalogRow[] {
  return rows.map((row) => {
    const hasMultipleDots = (dotCounts.get(row.product_id) ?? 1) > 1;
    return {
      id: `row-${row.product_id}-${row.dot}`,
      detailId: row.product_id,
      detailDot: hasMultipleDots ? row.dot : null,
      manufacturer: row.manufacturer as Manufacturer,
      model: row.model,
      width: row.width,
      ratio: row.ratio,
      rim: row.rim,
      spec: `${row.load_index} ${row.speed_index} ${row.ply} ${row.season}`,
      productCode: row.product_code,
      dot: row.dot,
      factoryPrice: includeSensitive ? row.factory_price : null,
      lowPrice: includeSensitive ? row.low_price : null,
      highPrice: includeSensitive ? row.high_price : null,
      stock: includeSensitive ? row.total_stock : null,
      discountRate: includeSensitive ? toNumber(row.max_discount_rate) : null,
      tag: (row.tag as CatalogRow["tag"] | null) ?? null,
      // No longer used for client-side sorting (the server now returns rows
      // already sorted), kept only so CatalogRow's shape is unchanged for
      // any other consumer. Derived from the product's createdAt so "larger
      // = registered more recently" still holds.
      registeredOrder: new Date(row.product_created_at).getTime(),
    };
  });
}

export async function getPublicCatalogPage(
  filters: CatalogFilters,
  sort: CatalogSortKey,
  page: number,
  pageSize: number,
  { includeSensitive }: { includeSensitive: boolean },
): Promise<CatalogPage> {
  const rawSize = filters.size ?? "";
  const trimmedSize = rawSize.trim();
  const parsedSize = trimmedSize ? parseTireSize(rawSize) : null;
  // Preserve existing behaviour: an unparsable, non-empty size string yields
  // zero results rather than "filter ignored" — short-circuit before ever
  // touching the database.
  if (trimmedSize.length > 0 && !parsedSize) {
    return { rows: [], total: 0 };
  }

  // Mirrors activeListingWhere above exactly (status ACTIVE, seller ACTIVE,
  // seller's user not withdrawn) — kept as its own SQL fragment because that
  // Prisma.ListingWhereInput object can't be reused inside a raw query, but
  // the semantics must never drift from it: a suspended/withdrawn seller's
  // listings must stay excluded from the public catalog.
  const conditions: Prisma.Sql[] = [
    Prisma.sql`l.status = 'ACTIVE'::"ListingStatus"`,
    Prisma.sql`s.status = 'ACTIVE'::"SellerStatus"`,
    Prisma.sql`u."withdrawnAt" IS NULL`,
  ];

  if (filters.manufacturer) {
    conditions.push(Prisma.sql`p.manufacturer = ${filters.manufacturer}`);
  }
  if (filters.model) {
    conditions.push(Prisma.sql`p.model ILIKE ${likeContains(filters.model)}`);
  }
  if (filters.productCode) {
    conditions.push(Prisma.sql`l."productCode" ILIKE ${likeContains(filters.productCode)}`);
  }
  if (filters.dot) {
    conditions.push(Prisma.sql`l.dot = ${filters.dot}`);
  }
  const widthCondition = exactNumberCondition(Prisma.sql`p.width`, filters.width);
  if (widthCondition) conditions.push(widthCondition);
  const ratioCondition = exactNumberCondition(Prisma.sql`p.ratio`, filters.ratio);
  if (ratioCondition) conditions.push(ratioCondition);
  const rimCondition = exactNumberCondition(Prisma.sql`p.rim`, filters.rim);
  if (rimCondition) conditions.push(rimCondition);
  // The parsed 사이즈 search box is an independent set of equality checks
  // (not merged with width/ratio/rim above) — same as the old client code,
  // which applied both simultaneously when both happened to be present.
  if (parsedSize) {
    conditions.push(Prisma.sql`p.width = ${parsedSize.width}`);
    conditions.push(Prisma.sql`p.ratio = ${parsedSize.ratio}`);
    conditions.push(Prisma.sql`p.rim = ${parsedSize.rim}`);
  }
  const whereSql = Prisma.join(conditions, " AND ");

  // `tag` on CatalogRow is not "does this group have an EVENT listing" — it's
  // the first *non-null* tag encountered in (createdAt asc, price asc) order
  // across the group (see the old toCatalogRow: `tags[0] ?? null` over
  // `listings.map(l => l.tag).filter(Boolean)`, where `listings` was already
  // sorted that way). rn_tag below reproduces that: rank rows within a group
  // by "has a tag" first (nulls last), then by the same createdAt/price
  // order, so rn_tag = 1 is that first non-null tag (or a null one if the
  // whole group has no tag).
  const cte = Prisma.sql`
    WITH filtered AS (
      SELECT
        l."productId" AS product_id,
        l.dot,
        l.price,
        l.stock,
        l."discountRate" AS discount_rate,
        l.tag,
        l."loadIndex" AS load_index,
        l."speedIndex" AS speed_index,
        l.ply,
        l.season,
        l."productCode" AS product_code,
        l."factoryPrice" AS factory_price,
        l."createdAt" AS listing_created_at
      FROM "Listing" l
      JOIN "Product" p ON p.id = l."productId"
      JOIN "Seller" s ON s.id = l."sellerId"
      JOIN "User" u ON u.id = s."userId"
      WHERE ${whereSql}
    ),
    ranked AS (
      SELECT f.*,
        ROW_NUMBER() OVER (
          PARTITION BY product_id, dot ORDER BY listing_created_at ASC, price ASC
        ) AS rn_rep,
        ROW_NUMBER() OVER (
          PARTITION BY product_id, dot
          ORDER BY (tag IS NULL) ASC, listing_created_at ASC, price ASC
        ) AS rn_tag
      FROM filtered f
    ),
    grouped AS (
      SELECT
        product_id,
        dot,
        MIN(price) AS low_price,
        MAX(price) AS high_price,
        SUM(stock)::int AS total_stock,
        MAX(discount_rate) AS max_discount_rate,
        MIN(listing_created_at) AS group_created_at
      FROM filtered
      GROUP BY product_id, dot
    ),
    representative AS (
      SELECT product_id, dot, load_index, speed_index, ply, season, product_code, factory_price
      FROM ranked WHERE rn_rep = 1
    ),
    tagged AS (
      SELECT product_id, dot, tag FROM ranked WHERE rn_tag = 1
    )
  `;

  const tagFilterSql = filters.tag ? Prisma.sql`WHERE t.tag = ${filters.tag}` : Prisma.empty;

  const selection = Prisma.sql`
    SELECT
      p.id AS product_id,
      p.manufacturer,
      p.model,
      p.width,
      p.ratio,
      p.rim,
      p."createdAt" AS product_created_at,
      r.dot,
      r.load_index,
      r.speed_index,
      r.ply,
      r.season,
      r.product_code,
      r.factory_price,
      g.low_price,
      g.high_price,
      g.total_stock,
      g.max_discount_rate,
      g.group_created_at,
      t.tag
    FROM representative r
    JOIN grouped g ON g.product_id = r.product_id AND g.dot = r.dot
    JOIN tagged t ON t.product_id = r.product_id AND t.dot = r.dot
    JOIN "Product" p ON p.id = r.product_id
    ${tagFilterSql}
  `;

  // Sort keys are validated against a fixed enum (isCatalogSortKey) before
  // reaching this function, so it's safe to splice these as raw SQL text —
  // this is developer-authored, not user input, and ORDER BY columns can't
  // be bound parameters anyway. Ties are broken to reproduce the previous
  // Array.prototype.sort's *stable* ordering over its pre-sort input, which
  // was `products` ordered by createdAt asc, then dot-groups in the order
  // they were first encountered within a product (i.e. by each group's
  // earliest listing's createdAt).
  const orderBySql = (() => {
    switch (sort) {
      case "popular":
        return Prisma.raw(
          `(CASE WHEN tag = 'BEST' THEN 0 ELSE 1 END) ASC, product_created_at ASC, group_created_at ASC`,
        );
      case "lowest":
        return Prisma.raw(`low_price ASC, product_created_at ASC, group_created_at ASC`);
      case "highest":
        return Prisma.raw(`high_price DESC, product_created_at ASC, group_created_at ASC`);
      case "discount":
        return Prisma.raw(`max_discount_rate DESC, product_created_at ASC, group_created_at ASC`);
      default:
        return Prisma.raw(`product_created_at DESC, group_created_at ASC`);
    }
  })();

  const offset = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<CatalogQueryRow[]>(
      Prisma.sql`${cte} ${selection} ORDER BY ${orderBySql} LIMIT ${pageSize} OFFSET ${offset}`,
    ),
    prisma.$queryRaw<{ count: number }[]>(
      Prisma.sql`${cte} SELECT COUNT(*)::int AS count FROM (${selection}) AS sub`,
    ),
  ]);

  const total = countRows[0]?.count ?? 0;
  if (rows.length === 0) {
    return { rows: [], total };
  }

  // detailDot (whether the product detail link needs ?dot=) depends on how
  // many distinct DOTs the product has across *all* its active listings —
  // not just the ones matching the current search filters — same as the old
  // `hasMultipleDots = groupByDot(product.listings).size > 1`, which grouped
  // every active listing before any client-side filter was applied. Fetched
  // separately, scoped to just the productIds on this page (at most
  // `pageSize` of them), so the main aggregation query above doesn't have to
  // duplicate its WHERE clause with and without the search filters.
  const productIds = [...new Set(rows.map((row) => row.product_id))];
  const dotCounts = new Map<string, number>();
  if (productIds.length > 0) {
    const counts = await prisma.$queryRaw<ProductDotCountRow[]>(Prisma.sql`
      SELECT l."productId" AS product_id, COUNT(DISTINCT l.dot)::int AS dot_count
      FROM "Listing" l
      JOIN "Seller" s ON s.id = l."sellerId"
      JOIN "User" u ON u.id = s."userId"
      WHERE l.status = 'ACTIVE'::"ListingStatus"
        AND s.status = 'ACTIVE'::"SellerStatus"
        AND u."withdrawnAt" IS NULL
        AND l."productId" IN (${Prisma.join(productIds)})
      GROUP BY l."productId"
    `);
    for (const row of counts) dotCounts.set(row.product_id, row.dot_count);
  }

  const catalogRows = toCatalogRows(rows, dotCounts, { includeSensitive });

  return { rows: catalogRows, total };
}
