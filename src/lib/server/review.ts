import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ORDER_STATUS, isCancelledOrderStatus, orderStatusRank, type OrderStatusValue } from "@/lib/order-status";
import type {
  ListingReviewSummary,
  ReviewListItem,
  ReviewOrderContext,
  ReviewOverview,
  ReviewView,
  ReviewableOrderView,
} from "@/lib/review-types";
import { prisma } from "./prisma";

// ---------------------------------------------------------------------------
// 리뷰 (product/seller reviews)
// ---------------------------------------------------------------------------
// Review.orderId is @unique (schema.prisma) — that single constraint is both
// "one review per order" and the proof that only a real buyer can write one:
// a review cannot exist without an order behind it, and createReview below
// always derives buyerId/sellerId/listingId from that order server-side,
// never from the request body. What the schema *can't* enforce on its own is
// *when* a real order becomes reviewable — that's the state-machine check in
// assertOrderIsReviewable.

export const createReviewSchema = z.object({
  orderId: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(1).max(2000),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(1).max(2000),
});

export class ReviewDomainError extends Error {
  constructor(
    public readonly code:
      | "ORDER_NOT_FOUND"
      | "NOT_ORDER_OWNER"
      | "ORDER_NOT_ELIGIBLE"
      | "REVIEW_ALREADY_EXISTS"
      | "REVIEW_NOT_FOUND"
      | "NOT_REVIEW_AUTHOR",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "ReviewDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof ReviewDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

// Every non-cancelled status whose rank is >= 배송완료's, computed from the
// shared orderStatusRank table (order-status.ts) rather than hardcoded here —
// so if that table ever grows a new terminal status ranked after 구매확정,
// this list picks it up automatically instead of silently staying stale.
// Today this evaluates to [배송완료, 구매확정].
const REVIEWABLE_STATUSES: readonly OrderStatusValue[] = (
  Object.values(ORDER_STATUS) as OrderStatusValue[]
).filter((status) => orderStatusRank[status] >= orderStatusRank[ORDER_STATUS.SHIPPING_COMPLETED]);

/**
 * The rule, straight from the order state machine: not cancelled
 * (isCancelledOrderStatus), and ranked at or past 배송완료 — using
 * orderStatusRank rather than string equality so 구매확정 (which ranks past
 * it) qualifies too, exactly as SHIPPING_COMPLETED does. A status with no
 * rank entry at all (shouldn't happen for a non-cancelled order, but the
 * rank table is keyed by a union type, not guaranteed at the DB layer) is
 * treated as not eligible rather than throwing.
 */
function isOrderReviewable(status: string): boolean {
  if (isCancelledOrderStatus(status)) return false;
  const rank = orderStatusRank[status as OrderStatusValue];
  return rank !== undefined && rank >= orderStatusRank[ORDER_STATUS.SHIPPING_COMPLETED];
}

const reviewableOrderInclude = {
  listing: { include: { product: true, seller: { select: { code: true } } } },
} satisfies Prisma.OrderInclude;

type ReviewableOrderRecord = Prisma.OrderGetPayload<{ include: typeof reviewableOrderInclude }>;

function toReviewableOrderView(order: ReviewableOrderRecord): ReviewableOrderView {
  return {
    orderId: order.id,
    productId: order.listing.productId,
    manufacturer: order.listing.product.manufacturer,
    model: order.listing.product.model,
    width: order.listing.product.width,
    ratio: order.listing.product.ratio,
    rim: order.listing.product.rim,
    dot: order.listing.dot,
    sellerCode: order.listing.seller.code,
    unitPrice: order.unitPrice,
    quantity: order.quantity,
    orderedAt: order.orderedAt.toISOString(),
  };
}

function toReviewView(review: Prisma.ReviewGetPayload<object>): ReviewView {
  return {
    id: review.id,
    orderId: review.orderId,
    sellerId: review.sellerId,
    listingId: review.listingId,
    rating: review.rating,
    content: review.content,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

/** first char visible, rest masked with matching length — same convention as
 * maskLoginId in findId.ts. A review is shown to any visitor of the product
 * page (including the reviewer's business competitors), so the reviewing
 * buyer's full businessName is never sent to the client. */
function maskBusinessName(name: string): string {
  if (name.length <= 1) return `${name}*`;
  return `${name.slice(0, 1)}${"*".repeat(Math.max(name.length - 1, 1))}`;
}

/**
 * Orders the signed-in buyer could start a *new* review for: not cancelled,
 * ranked at/past 배송완료, and no review yet (`review: null` filters on the
 * Order -> Review optional one-to-one back-relation). Backs the picker shown
 * at /reviews/new when it's opened without an ?orderId.
 */
export async function getReviewableOrders(buyerId: string): Promise<ReviewableOrderView[]> {
  const orders = await prisma.order.findMany({
    where: {
      buyerId,
      status: { in: [...REVIEWABLE_STATUSES] },
      review: null,
    },
    orderBy: { orderedAt: "desc" },
    include: reviewableOrderInclude,
  });
  return orders.map(toReviewableOrderView);
}

/**
 * Everything /reviews/new needs for one specific order: whether it's
 * reviewable, its display context, and any review already written for it
 * (so the page can render an edit form instead of a create form). Ownership
 * is enforced here, not left to the caller — a buyer can never load another
 * buyer's order context this way.
 */
export async function getReviewOrderContext(orderId: string, buyerId: string): Promise<ReviewOrderContext> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { ...reviewableOrderInclude, review: true },
  });
  if (!order) throw new ReviewDomainError("ORDER_NOT_FOUND", 404);
  if (order.buyerId !== buyerId) throw new ReviewDomainError("NOT_ORDER_OWNER", 403);

  return {
    eligible: isOrderReviewable(order.status),
    order: toReviewableOrderView(order),
    review: order.review ? toReviewView(order.review) : null,
  };
}

/** Ownership + eligibility enforced server-side before any write — never
 * trust orderId/buyerId pairing from the request beyond "the session says
 * this buyer". */
export async function createReview(buyerId: string, data: z.infer<typeof createReviewSchema>): Promise<ReviewView> {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { id: true, buyerId: true, sellerId: true, listingId: true, status: true },
  });
  if (!order) throw new ReviewDomainError("ORDER_NOT_FOUND", 404);
  if (order.buyerId !== buyerId) throw new ReviewDomainError("NOT_ORDER_OWNER", 403);
  if (!isOrderReviewable(order.status)) throw new ReviewDomainError("ORDER_NOT_ELIGIBLE", 409);

  try {
    const created = await prisma.review.create({
      data: {
        orderId: order.id,
        buyerId,
        sellerId: order.sellerId,
        listingId: order.listingId,
        rating: data.rating,
        content: data.content,
      },
    });
    return toReviewView(created);
  } catch (error) {
    // orderId is @unique: two concurrent submissions for the same order (two
    // tabs, a retried request) race on this insert. The loser gets a domain
    // error here instead of a raw 500 — it isn't a server failure, the review
    // just already exists.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ReviewDomainError("REVIEW_ALREADY_EXISTS", 409);
    }
    throw error;
  }
}

/**
 * Author-only edit. Deliberately no deletion counterpart — see the module
 * doc comment near the bottom of this file for why.
 */
export async function updateReview(
  reviewId: string,
  buyerId: string,
  data: z.infer<typeof updateReviewSchema>,
): Promise<ReviewView> {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw new ReviewDomainError("REVIEW_NOT_FOUND", 404);
  if (review.buyerId !== buyerId) throw new ReviewDomainError("NOT_REVIEW_AUTHOR", 403);

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { rating: data.rating, content: data.content },
  });
  return toReviewView(updated);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Rating summary (average + count) per seller, plus a bounded, most-recent
 * feed of individual reviews, for the sellers behind a set of listingIds —
 * i.e. exactly the rows shown in the product page's 판매점별 비교 table.
 *
 * "Per seller" (not "per listing") is deliberate: a seller's overall
 * reputation is what a buyer weighs when choosing between sellers on that
 * screen (see the module doc comment), and a single listing (one specific
 * product+DOT from one seller) would often have zero or near-zero reviews of
 * its own even for a well-reviewed seller. listingId is only how the caller
 * identifies "which row" — internally this resolves each listingId to its
 * Listing.sellerId and aggregates by that.
 *
 * Efficiency: the average/count comes from `groupBy`, which returns one
 * aggregated row per distinct seller — never every matching Review row. The
 * review feed is a single `findMany` capped with `take`, not "every review
 * for these sellers" — also never unbounded. Both queries hit Review's
 * existing @@index([sellerId]).
 */
export async function getReviewOverviewForListings(listingIds: readonly string[]): Promise<ReviewOverview> {
  const uniqueListingIds = [...new Set(listingIds)].filter(Boolean);
  if (uniqueListingIds.length === 0) {
    return { summaryByListingId: {}, recentReviews: [] };
  }

  const listings = await prisma.listing.findMany({
    where: { id: { in: uniqueListingIds } },
    select: { id: true, sellerId: true },
  });
  const sellerIdByListingId = new Map(listings.map((listing) => [listing.id, listing.sellerId] as const));
  const sellerIds = [...new Set(listings.map((listing) => listing.sellerId))];
  if (sellerIds.length === 0) {
    return { summaryByListingId: {}, recentReviews: [] };
  }

  const RECENT_REVIEWS_LIMIT = 20;
  const [aggregates, recent] = await Promise.all([
    prisma.review.groupBy({
      by: ["sellerId"],
      where: { sellerId: { in: sellerIds } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.review.findMany({
      where: { sellerId: { in: sellerIds } },
      orderBy: { createdAt: "desc" },
      take: RECENT_REVIEWS_LIMIT,
      select: {
        id: true,
        sellerId: true,
        rating: true,
        content: true,
        createdAt: true,
        buyer: { select: { businessName: true } },
      },
    }),
  ]);

  const summaryBySellerId = new Map(
    aggregates.map(
      (row) =>
        [
          row.sellerId,
          { averageRating: round1(row._avg.rating ?? 0), reviewCount: row._count._all } satisfies Omit<
            ListingReviewSummary,
            "sellerId"
          >,
        ] as const,
    ),
  );

  const summaryByListingId: Record<string, ListingReviewSummary> = {};
  for (const listingId of uniqueListingIds) {
    const sellerId = sellerIdByListingId.get(listingId);
    if (!sellerId) continue;
    const summary = summaryBySellerId.get(sellerId) ?? { averageRating: 0, reviewCount: 0 };
    summaryByListingId[listingId] = { sellerId, ...summary };
  }

  const recentReviews: ReviewListItem[] = recent.map((review) => ({
    id: review.id,
    sellerId: review.sellerId,
    rating: review.rating,
    content: review.content,
    createdAt: review.createdAt.toISOString(),
    buyerLabel: maskBusinessName(review.buyer.businessName),
  }));

  return { summaryByListingId, recentReviews };
}

// ---------------------------------------------------------------------------
// Deletion: deliberately not implemented. Editing (updateReview above) is —
// a buyer who made a mistake, wants to update their opinion, or accidentally
// included something they shouldn't have can already fix that in place.
// Silent deletion is a different thing: this feature's whole point is a
// per-seller trust signal other buyers rely on to choose between sellers,
// and a review only exists because Review.orderId proves a real completed
// purchase happened. Free, unmoderated deletion would let that evidence
// disappear with no trace and no oversight — including under off-platform
// pressure from the seller being reviewed ("delete the bad review and I'll
// handle the refund"), which is undetectable precisely because nothing
// records that a review ever existed once it's gone. No admin/moderation
// screen for reviews was in scope for this task either, so a self-service
// delete would be the least-supervised way to make a completed-purchase
// review vanish. If a genuine need to remove one shows up later (legal
// request, harassment, etc.), that belongs behind an admin action with a
// logged reason (AdminActionLog, same as every other moderation action in
// this codebase) — not a plain DELETE a buyer can call on their own.
