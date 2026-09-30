import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  CANCEL_STATUS,
  isCancelledOrderStatus,
  ORDER_STATUS,
  orderStatusRank,
  type OrderStatusValue,
} from "@/lib/order-status";
import type {
  AdminReturnRequestView,
  BuyerReturnRequestView,
  ReturnEligibleOrderView,
  ReturnRequestOrderContext,
  ReturnRequestView,
  SellerReturnRequestView,
} from "@/lib/return-types";
import { prisma } from "./prisma";
import { notifyUser } from "./notify";
import { AUTO_REFUND_TOSS_FAILURE_REASON, restoreListingStockForCancelledOrder } from "./orders";
import { createSettlementClawbackForOrder } from "./payout";

// ---------------------------------------------------------------------------
// 교환 / 반품
// ---------------------------------------------------------------------------
// ReturnRequest.orderId is @unique (schema.prisma) — same load-bearing shape
// as Review.orderId (see review.ts's module header): it is both "one request
// per order" and the proof that only a real buyer can file one, since
// createReturnRequest always derives buyerId/sellerId from the order
// server-side, never from the request body.
//
// ELIGIBILITY WINDOW. A return/exchange only makes sense once goods have
// actually arrived, and cancelOrder (orders.ts) already owns every
// pre-delivery cancellation path (입금대기 -> 입금전취소, 입금완료 ~ 배송중 ->
// 입금후취소, blocked once SHIPPED/DELIVERED for a non-admin actor). This
// feature deliberately starts exactly where that one stops, rather than
// building a second, overlapping cancellation path: eligible statuses are
// every ORDER_STATUS ranked at or past 배송완료 (mirrors REVIEWABLE_STATUSES
// in review.ts byte-for-byte — writing a review and requesting a return are
// both "the goods are in the buyer's hands now" actions, so they share the
// same floor), and never a status isCancelledOrderStatus already covers.
// Both conditions are checked with the same helper cancelOrder itself uses
// (orderStatusRank / isCancelledOrderStatus), so this can never drift from
// what "already cancelled" or "already shipped" mean elsewhere in the app.
//
// One deliberate choice: 구매확정 (rank past 배송완료) stays eligible, same as
// review.ts. A defect can surface after the buyer has confirmed receipt, and
// nothing about confirming a purchase should forfeit the ability to report a
// problem with what arrived — see the report for the already-settled-order
// consequence this implies for payout, which this module cannot fix (payout.ts
// is off-limits) and only documents.
const RETURN_ELIGIBLE_STATUSES: readonly OrderStatusValue[] = (
  Object.values(ORDER_STATUS) as OrderStatusValue[]
).filter((status) => orderStatusRank[status] >= orderStatusRank[ORDER_STATUS.SHIPPING_COMPLETED]);

function isOrderReturnEligible(status: string): boolean {
  if (isCancelledOrderStatus(status)) return false;
  const rank = orderStatusRank[status as OrderStatusValue];
  return rank !== undefined && rank >= orderStatusRank[ORDER_STATUS.SHIPPING_COMPLETED];
}

// Refund bookkeeping reason recorded on Payment when a RETURN completes.
// Deliberately distinct from AUTO_REFUND_TOSS_FAILURE_REASON (orders.ts) —
// that marker specifically means "an automated Toss cancel call was
// attempted and failed"; this one means "nothing was attempted, by design —
// see completeReturnRequest". Both leave Payment.refundRequiredAt set, which
// is all settlement.ts's getDeposits and /admin/orders' banner actually key
// on, so an operator sees the same "환불 필요" signal either way; the reason
// string is diagnostic only.
const RETURN_REFUND_REASON = "RETURN_COMPLETED_NEEDS_MANUAL_REFUND";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

export const createReturnRequestSchema = z.object({
  orderId: z.string().trim().min(1).max(200),
  type: z.enum(["EXCHANGE", "RETURN"]),
  reason: z.string().trim().min(1).max(80),
  detail: nullableText(1000),
});

// Reused for both the seller and the admin REQUESTED -> APPROVED/REJECTED
// transition — same shape as adminReviewSchema (admin.ts), same reasoning:
// `reason` is required only when rejecting (enforced in processReturnRequest,
// not here, since zod can't see the value of `approve` while validating
// `reason` in one declarative pass).
export const processReturnRequestSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export class ReturnDomainError extends Error {
  constructor(
    public readonly code: "ORDER_NOT_FOUND" | "ORDER_NOT_ELIGIBLE" | "RETURN_REQUEST_ALREADY_EXISTS",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "ReturnDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof ReturnDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function toReturnRequestView(record: Prisma.ReturnRequestGetPayload<object>): ReturnRequestView {
  return {
    id: record.id,
    orderId: record.orderId,
    type: record.type,
    reason: record.reason,
    detail: record.detail,
    status: record.status,
    rejectReason: record.rejectReason,
    requestedAt: record.requestedAt.toISOString(),
    processedAt: record.processedAt?.toISOString() ?? null,
  };
}

const eligibleOrderInclude = {
  listing: { include: { product: true, seller: { select: { code: true } } } },
} satisfies Prisma.OrderInclude;

type EligibleOrderRecord = Prisma.OrderGetPayload<{ include: typeof eligibleOrderInclude }>;

function toEligibleOrderView(order: EligibleOrderRecord): ReturnEligibleOrderView {
  return {
    orderId: order.id,
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

/**
 * Orders the signed-in buyer could start a *new* exchange/return request
 * for: eligible by the state-machine rule above, and no request yet
 * (`returnRequest: null` filters on the Order -> ReturnRequest optional
 * back-relation, same idea as `review: null` in getReviewableOrders).
 * Backs the picker shown at /mypage/returns/new when opened without an
 * ?orderId.
 */
export async function getReturnEligibleOrders(buyerId: string): Promise<ReturnEligibleOrderView[]> {
  const orders = await prisma.order.findMany({
    where: {
      buyerId,
      status: { in: [...RETURN_ELIGIBLE_STATUSES] },
      returnRequest: null,
    },
    orderBy: { orderedAt: "desc" },
    include: eligibleOrderInclude,
  });
  return orders.map(toEligibleOrderView);
}

/**
 * Everything /mypage/returns/new needs for one specific order: whether it's
 * eligible, its display context, and any request already filed for it (so
 * the page can render a status view instead of a create form). Ownership is
 * enforced here, not left to the caller — mirrors getReviewOrderContext.
 */
export async function getReturnRequestOrderContext(
  orderId: string,
  buyerId: string,
): Promise<ReturnRequestOrderContext> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { ...eligibleOrderInclude, returnRequest: true },
  });
  if (!order) throw new ReturnDomainError("ORDER_NOT_FOUND", 404);
  if (order.buyerId !== buyerId) throw new ReturnDomainError("ORDER_NOT_FOUND", 404);

  return {
    eligible: isOrderReturnEligible(order.status),
    order: toEligibleOrderView(order),
    returnRequest: order.returnRequest ? toReturnRequestView(order.returnRequest) : null,
  };
}

/**
 * Create a request for `buyerId`. Ownership + eligibility enforced
 * server-side before any write, exactly like createReview.
 *
 * No retry-after-rejection path here, unlike TaxInvoice's per-month request:
 * ReturnRequest.orderId is @unique with no notion of "period" to reopen — a
 * REJECTED request means "the seller/admin declined this specific order's
 * exchange/return", and the unique constraint correctly makes that decision
 * final rather than something a buyer can silently retry by resubmitting.
 * (A buyer who disagrees has the same off-platform escalation path — 고객센터
 * — as any other rejected decision in this app; there is no in-schema
 * dispute/appeal flow.)
 */
export async function createReturnRequest(
  buyerId: string,
  data: z.infer<typeof createReturnRequestSchema>,
): Promise<ReturnRequestView> {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { id: true, buyerId: true, sellerId: true, status: true },
  });
  if (!order || order.buyerId !== buyerId) throw new ReturnDomainError("ORDER_NOT_FOUND", 404);
  if (!isOrderReturnEligible(order.status)) throw new ReturnDomainError("ORDER_NOT_ELIGIBLE", 409);

  let created: Prisma.ReturnRequestGetPayload<object>;
  try {
    created = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        buyerId,
        sellerId: order.sellerId,
        type: data.type,
        reason: data.reason,
        detail: data.detail ?? null,
      },
    });
  } catch (error) {
    // orderId is @unique: two concurrent submissions for the same order race
    // on this insert, or the buyer double-clicked. The loser gets a domain
    // error, not a raw 500 — same pattern as createReview.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ReturnDomainError("RETURN_REQUEST_ALREADY_EXISTS", 409);
    }
    throw error;
  }

  // Seller-facing "새 교환/반품 신청" notification. Not wrapped in the create
  // above (a single prisma.create() is already atomic on its own; there is
  // no multi-statement transaction here to commit before notifying), but
  // still fired only after the write has resolved, per notify.ts's rule.
  const seller = await prisma.seller.findUnique({ where: { id: order.sellerId }, select: { userId: true } });
  if (seller) {
    await notifyUser(seller.userId, "SELLER_RETURN_REQUEST_RECEIVED", {
      subject: data.type === "EXCHANGE" ? "새 교환 신청이 접수되었습니다" : "새 반품 신청이 접수되었습니다",
      body: `주문(${order.id})에 대한 ${data.type === "EXCHANGE" ? "교환" : "반품"} 신청이 접수되었습니다. 판매자 페이지에서 확인해 주세요.`,
    });
  }

  return toReturnRequestView(created);
}

const buyerReturnRequestInclude = {
  order: {
    include: { listing: { include: { product: true, seller: { select: { code: true } } } } },
  },
} satisfies Prisma.ReturnRequestInclude;

type BuyerReturnRequestRecord = Prisma.ReturnRequestGetPayload<{ include: typeof buyerReturnRequestInclude }>;

function toBuyerReturnRequestView(record: BuyerReturnRequestRecord): BuyerReturnRequestView {
  return {
    ...toReturnRequestView(record),
    sellerCode: record.order.listing.seller.code,
    order: {
      orderNo: record.order.orderNo,
      manufacturer: record.order.listing.product.manufacturer,
      model: record.order.listing.product.model,
      width: record.order.listing.product.width,
      ratio: record.order.listing.product.ratio,
      rim: record.order.listing.product.rim,
      dot: record.order.listing.dot,
      unitPrice: record.order.unitPrice,
      quantity: record.order.quantity,
      total: record.order.unitPrice * record.order.quantity + record.order.extraShipping + record.order.shippingFee,
      orderedAt: record.order.orderedAt.toISOString(),
    },
  };
}

/** The signed-in buyer's own requests — /mypage/returns. */
export async function getBuyerReturnRequests(buyerId: string): Promise<BuyerReturnRequestView[]> {
  const requests = await prisma.returnRequest.findMany({
    where: { buyerId },
    orderBy: { requestedAt: "desc" },
    include: buyerReturnRequestInclude,
  });
  return requests.map(toBuyerReturnRequestView);
}

const sellerReturnRequestInclude = {
  order: {
    include: { listing: { include: { product: true } } },
  },
  buyer: { select: { businessName: true, ownerName: true, mobilePhone: true } },
} satisfies Prisma.ReturnRequestInclude;

type SellerReturnRequestRecord = Prisma.ReturnRequestGetPayload<{ include: typeof sellerReturnRequestInclude }>;

function toSellerReturnRequestView(record: SellerReturnRequestRecord): SellerReturnRequestView {
  return {
    ...toReturnRequestView(record),
    buyer: record.buyer,
    order: {
      orderNo: record.order.orderNo,
      manufacturer: record.order.listing.product.manufacturer,
      model: record.order.listing.product.model,
      width: record.order.listing.product.width,
      ratio: record.order.listing.product.ratio,
      rim: record.order.listing.product.rim,
      dot: record.order.listing.dot,
      unitPrice: record.order.unitPrice,
      quantity: record.order.quantity,
      total: record.order.unitPrice * record.order.quantity + record.order.extraShipping + record.order.shippingFee,
      orderedAt: record.order.orderedAt.toISOString(),
    },
  };
}

/** This seller's processing queue — /seller/returns. */
export async function getSellerReturnRequests(sellerId: string): Promise<SellerReturnRequestView[]> {
  const requests = await prisma.returnRequest.findMany({
    where: { sellerId },
    // Needs-attention-first, same idea as getAdminInquiries: REQUESTED and
    // APPROVED (still awaiting a seller/admin action) before the terminal
    // REJECTED/COMPLETED rows. ReturnStatus's declared enum order is
    // REQUESTED, APPROVED, REJECTED, COMPLETED, which already sorts that way
    // ascending — see the comment on getAdminReturnRequests below for why
    // `asc` here is declaration-order, not alphabetical.
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: sellerReturnRequestInclude,
  });
  return requests.map(toSellerReturnRequestView);
}

/**
 * sellerId -> "businessName (code)" for the admin queue, so a human triaging
 * requests isn't staring at a bare cuid. ReturnRequest.sellerId is a plain
 * scalar column (no Prisma relation — schema.prisma has no `seller Seller
 * @relation` field on this model), so this is a second, bounded query
 * rather than a `select`-time join — bounded because it only ever looks up
 * the distinct sellerIds actually present on the page of requests just
 * fetched. Mirrors buildListingLabels in inquiry.ts exactly.
 */
async function buildSellerLabels(
  sellerIds: readonly string[],
): Promise<Map<string, { id: string; code: string; businessName: string }>> {
  const uniqueIds = [...new Set(sellerIds)];
  if (uniqueIds.length === 0) return new Map();
  const sellers = await prisma.seller.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, code: true, user: { select: { businessName: true } } },
  });
  return new Map(
    sellers.map((seller) => [seller.id, { id: seller.id, code: seller.code, businessName: seller.user.businessName }] as const),
  );
}

/** Admin's queue — every seller's requests, optionally filtered by status. */
export async function getAdminReturnRequests(status?: string): Promise<AdminReturnRequestView[]> {
  const validStatus =
    status && ["REQUESTED", "APPROVED", "REJECTED", "COMPLETED"].includes(status)
      ? (status as "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED")
      : undefined;
  const requests = await prisma.returnRequest.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    // asc here sorts by ReturnStatus's *declared* enum order (REQUESTED,
    // APPROVED, REJECTED, COMPLETED — schema.prisma), not alphabetically;
    // Postgres enums always sort by declaration order. That happens to be
    // exactly "needs attention first", same outcome getAdminInquiries gets
    // from OPEN/ANSWERED/CLOSED sorting alphabetically — different
    // mechanism, same result, so it's called out explicitly here to avoid
    // future confusion between the two.
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: sellerReturnRequestInclude,
  });

  const sellerLabels = await buildSellerLabels(requests.map((request) => request.sellerId));
  return requests.map((request) => {
    const seller = sellerLabels.get(request.sellerId) ?? { id: request.sellerId, code: "-", businessName: "-" };
    return { ...toSellerReturnRequestView(request), seller };
  });
}

type ReturnActor = { kind: "SELLER"; sellerId: string; userId: string } | { kind: "ADMIN"; userId: string };

export type ProcessReturnRequestResult =
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_STATUS"; status: string }
  | { kind: "REASON_REQUIRED" }
  | { kind: "OK"; returnRequest: ReturnRequestView };

/**
 * REQUESTED -> APPROVED or REJECTED. Seller (their own sellerId only) or
 * admin (any). Rejection requires a reason. Mirrors reviewAdminListing's
 * shape exactly (admin.ts) — a staff decision with two outcomes, one of
 * which needs a reason, logged to AdminActionLog only for the ADMIN actor
 * (mirrors cancelOrder: SELLER actions are never logged there, since that
 * table is specifically an *admin* action log).
 */
export async function processReturnRequest(
  returnRequestId: string,
  actor: ReturnActor,
  data: z.infer<typeof processReturnRequestSchema>,
): Promise<ProcessReturnRequestResult> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.returnRequest.findUnique({ where: { id: returnRequestId } });
    if (!existing) return { kind: "NOT_FOUND" as const };
    if (actor.kind === "SELLER" && existing.sellerId !== actor.sellerId) return { kind: "NOT_FOUND" as const };
    if (existing.status !== "REQUESTED") return { kind: "INVALID_STATUS" as const, status: existing.status };
    if (!data.approve && !data.reason?.trim()) return { kind: "REASON_REQUIRED" as const };

    // Guarded updateMany on the request's own current status — same
    // lost-the-race pattern as confirmPurchase/completeReturnRequest, so a
    // concurrent double-decision (two approve/reject calls racing on a stale
    // read) can't have the second silently overwrite the first.
    const marked = await tx.returnRequest.updateMany({
      where: { id: returnRequestId, status: "REQUESTED" },
      data: {
        status: data.approve ? "APPROVED" : "REJECTED",
        rejectReason: data.approve ? null : data.reason!.trim(),
        processedAt: new Date(),
        processedBy: actor.userId,
      },
    });
    if (marked.count !== 1) return { kind: "INVALID_STATUS" as const, status: existing.status };

    const updated = await tx.returnRequest.findUniqueOrThrow({ where: { id: returnRequestId } });

    if (actor.kind === "ADMIN") {
      await tx.adminActionLog.create({
        data: {
          adminId: actor.userId,
          action: data.approve ? "RETURN_REQUEST_APPROVE" : "RETURN_REQUEST_REJECT",
          targetType: "ReturnRequest",
          targetId: returnRequestId,
          reason: data.approve ? null : data.reason!.trim(),
        },
      });
    }

    return { kind: "OK" as const, record: updated };
  });

  if (result.kind !== "OK") return result;

  // Buyer-facing notification, only after the transaction has committed —
  // see notify.ts's file header.
  await notifyUser(
    result.record.buyerId,
    data.approve ? "BUYER_RETURN_REQUEST_APPROVED" : "BUYER_RETURN_REQUEST_REJECTED",
    data.approve
      ? {
          subject: result.record.type === "EXCHANGE" ? "교환 신청이 승인되었습니다" : "반품 신청이 승인되었습니다",
          body: `주문(${result.record.orderId})의 ${result.record.type === "EXCHANGE" ? "교환" : "반품"} 신청이 승인되었습니다.`,
        }
      : {
          subject: result.record.type === "EXCHANGE" ? "교환 신청이 반려되었습니다" : "반품 신청이 반려되었습니다",
          body: `주문(${result.record.orderId})의 ${result.record.type === "EXCHANGE" ? "교환" : "반품"} 신청이 반려되었습니다. 사유: ${result.record.rejectReason}`,
        },
  );

  return { kind: "OK" as const, returnRequest: toReturnRequestView(result.record) };
}

export type CompleteReturnRequestResult =
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_STATUS"; status: string }
  | { kind: "ORDER_ALREADY_CANCELLED" }
  | { kind: "ORDER_STATE_CHANGED" }
  | { kind: "OK"; returnRequest: ReturnRequestView };

/**
 * APPROVED -> COMPLETED. This is where the buyer-visible effects of a
 * finished exchange/return actually happen: Order.status moves to the
 * matching CANCEL_STATUS value, and — for a RETURN only — stock comes back
 * and a refund is recorded as owed. See the report for the full reasoning;
 * summarised here:
 *
 *   - RETURN: goods physically come back, so stock is restored via
 *     restoreListingStockForCancelledOrder — the exact same helper
 *     cancelOrder/expireStaleUnpaidOrders/the Toss webhook all share, never
 *     reimplemented. Money is recorded as owed on Payment
 *     (refundRequiredAt/refundReason/refundAmount — the same fields and the
 *     same "increment, never overwrite the running total" shape cancelOrder
 *     itself writes) but this function deliberately does NOT call Toss the
 *     way cancelOrder does. That is a considered choice, not a shortcut —
 *     see the report — and it plugs directly into machinery that already
 *     exists: /admin/orders' "환불 필요" banner already renders off exactly
 *     these fields, and the Toss webhook (src/app/api/payments/toss/webhook)
 *     already reconciles refundRequiredAt down to 0 the moment Toss reports
 *     the corresponding cancellation, however it was actually submitted
 *     (console or otherwise). Nothing new has to be built for the flag this
 *     function sets to eventually clear correctly.
 *   - EXCHANGE: the same goods (or a replacement of them) ship again, so
 *     nothing about stock or money changes here at all — Listing.stock is
 *     left untouched (the original order already decremented it once, and
 *     there is no second Order row for the replacement to decrement against
 *     a second time) and Payment is never touched. Order.status still moves
 *     to EXCHANGE_COMPLETED (a CANCEL_STATUS value — see order-status.ts) but
 *     payout.ts's settleableInPeriodWhere deliberately does NOT exclude that
 *     one status: an exchange is a completed sale, not a cancelled one, so
 *     the order stays (or becomes) settleable exactly like any other
 *     fulfilled order — see nonSettleableStatusValues in payout.ts.
 *
 * One more effect, for a RETURN only: if this order was already claimed into
 * a settlement (order.settlementId !== null — the seller has already been
 * paid for it), the buyer refund recorded above is not enough on its own;
 * the money already paid out to the seller for this order also has to come
 * back. createSettlementClawbackForOrder (payout.ts) records that as a
 * SettlementAdjustment, absorbed into the seller's next confirmPayout — see
 * that function's comment for the full mechanism. This is independent of the
 * buyer-refund clamp above (clampedAmount): that clamp answers "how much can
 * still be owed to the buyer on this payment"; the clawback answers "how
 * much did the seller keep for this order" — unrelated questions, so one
 * must never cap the other.
 */
export async function completeReturnRequest(
  returnRequestId: string,
  actor: ReturnActor,
): Promise<CompleteReturnRequestResult> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { order: { include: { listing: true } } },
    });
    if (!existing) return { kind: "NOT_FOUND" as const };
    if (actor.kind === "SELLER" && existing.sellerId !== actor.sellerId) return { kind: "NOT_FOUND" as const };
    if (existing.status !== "APPROVED") return { kind: "INVALID_STATUS" as const, status: existing.status };

    const order = existing.order;
    // Defensive, not expected in practice: nothing in this codebase can move
    // a SHIPPING_COMPLETED/PURCHASE_CONFIRMED order to a cancelled status
    // except cancelOrder's ADMIN path (the only actor kind cancelOrder lets
    // cancel a shipped order) or the Toss webhook's full-cancel reconcile.
    // If either happened after this request was APPROVED, refuse rather than
    // pile a second "cancellation" on top of the first.
    if (isCancelledOrderStatus(order.status)) {
      return { kind: "ORDER_ALREADY_CANCELLED" as const };
    }

    const nextOrderStatus =
      existing.type === "EXCHANGE" ? CANCEL_STATUS.EXCHANGE_COMPLETED : CANCEL_STATUS.RETURN_COMPLETED;

    // Guarded updateMany on the order's own current status — same
    // lost-the-race pattern as cancelOrder/confirmPurchase. This is
    // deliberately the FIRST write in this transaction: if it matches 0 rows
    // we return immediately with nothing else written, so the transaction
    // commits as a harmless no-op rather than needing a rollback.
    const markedOrder = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: nextOrderStatus },
    });
    if (markedOrder.count !== 1) return { kind: "ORDER_STATE_CHANGED" as const };

    const updatedReturn = await tx.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: "COMPLETED", processedAt: new Date(), processedBy: actor.userId },
    });

    let refundOwedAmount = 0;
    let clawbackCreated = false;

    if (existing.type === "RETURN") {
      await restoreListingStockForCancelledOrder(tx, {
        listingId: order.listingId,
        quantity: order.quantity,
        listingStatus: order.listing.status,
      });

      if (order.paymentId) {
        const payment = await tx.payment.findUnique({ where: { id: order.paymentId } });
        if (payment && payment.status === "DONE") {
          const cancelledOrderAmount = order.unitPrice * order.quantity + order.extraShipping + order.shippingFee;
          // Same over-refund guard as cancelOrder: never record more as
          // owed than this payment could still owe by our own bookkeeping.
          // In the healthy case this never clamps — a RETURN-eligible order
          // cannot also have been cancelled (isCancelledOrderStatus already
          // excludes it from eligibility), so its amount was never counted
          // toward refundAmount before now.
          const localRemainingBalance = Math.max(0, payment.amount - payment.refundAmount);
          const clampedAmount = Math.min(cancelledOrderAmount, localRemainingBalance);
          if (clampedAmount > 0) {
            // Never let this write paper over an already-recorded, unresolved
            // Toss failure on this same payment — same rule cancelOrder
            // enforces for the identical reason (AUTO_REFUND_TOSS_FAILURE_REASON's
            // definition in orders.ts).
            const preserveExistingFailureMarker = payment.refundReason === AUTO_REFUND_TOSS_FAILURE_REASON;
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                refundRequiredAt: new Date(),
                refundReason: preserveExistingFailureMarker ? payment.refundReason : RETURN_REFUND_REASON,
                refundAmount: { increment: clampedAmount },
              },
            });
            refundOwedAmount = clampedAmount;
          }
        }
      }

      // 정산 후 회수(클로백): buyer refund above is tracked on Payment, but
      // that alone leaves the seller's earlier payout for this order
      // untouched. If this order was already claimed into a settlement, the
      // seller has already been paid for it — record the clawback so the
      // next confirmPayout for this seller nets it out. See the function doc
      // comment and payout.ts's createSettlementClawbackForOrder.
      if (order.settlementId !== null) {
        await createSettlementClawbackForOrder(
          tx,
          {
            id: order.id,
            sellerId: order.sellerId,
            settlementId: order.settlementId,
            unitPrice: order.unitPrice,
            quantity: order.quantity,
            extraShipping: order.extraShipping,
            shippingFee: order.shippingFee,
          },
          "RETURN_COMPLETED_AFTER_SETTLEMENT",
        );
        clawbackCreated = true;
      }
    }

    return {
      kind: "OK" as const,
      record: updatedReturn,
      refundOwedAmount,
      clawbackCreated,
      orderId: order.id,
    };
  });

  if (result.kind !== "OK") return result;

  // Not an error — a normal, now fully-handled outcome — but still worth a
  // grep-able log for an operator reconciling payouts, same spirit as the
  // other durable-money-event logs in this codebase.
  if (result.clawbackCreated) {
    console.error("RETURN_COMPLETED_SETTLEMENT_CLAWBACK_CREATED", {
      orderId: result.orderId,
      refundOwedAmount: result.refundOwedAmount,
    });
  }

  await notifyUser(result.record.buyerId, "BUYER_RETURN_REQUEST_COMPLETED", {
    subject: result.record.type === "EXCHANGE" ? "교환이 완료되었습니다" : "반품이 완료되었습니다",
    body:
      result.record.type === "EXCHANGE"
        ? `주문(${result.record.orderId})의 교환이 완료되었습니다. 동일 상품으로 재발송됩니다.`
        : result.refundOwedAmount > 0
          ? `주문(${result.record.orderId})의 반품이 완료되었습니다. 결제하신 금액은 확인 후 환불될 예정입니다.`
          : `주문(${result.record.orderId})의 반품이 완료되었습니다.`,
  });

  return { kind: "OK" as const, returnRequest: toReturnRequestView(result.record) };
}
