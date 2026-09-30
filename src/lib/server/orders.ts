import { Prisma, type ShippingStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { CartItem } from "@/lib/types";
import {
  CANCEL_STATUS,
  isCancelledOrderStatus,
  ORDER_STATUS,
  orderStatusRank,
  SHIPPING_STATUS_LABEL,
  type OrderStatusValue,
} from "@/lib/order-status";
import { prisma } from "./prisma";
import { notifyUser } from "./notify";
import { resolveExtraShipping, resolveSellerShippingFee } from "./pricing";
import { createSettlementClawbackForOrder, nonSettleableStatusValues } from "./payout";

const orderItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  tireId: z.string().trim().min(1).max(200),
  manufacturer: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  width: z.coerce.number().int().min(1).max(999),
  ratio: z.coerce.number().int().min(1).max(999),
  rim: z.coerce.number().int().min(1).max(99),
  dot: z.string().trim().min(1).max(20),
  price: z.coerce.number().int().min(0).max(100_000_000),
  quantity: z.coerce.number().int().min(1).max(100_000),
  extraShipping: z.coerce.number().int().min(0).max(1_000_000),
  sellerCode: z.string().trim().min(1).max(40),
  stock: z.coerce.number().int().min(0).max(1_000_000).optional(),
  listingId: z.string().trim().min(1).max(200).optional(),
});

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

// Task 3 — 주문서: the shipping snapshot every order created from checkout
// must carry. Required fields mirror ShippingAddress's own required columns
// (schema.prisma) exactly, so "pick a saved address" and "type a new one"
// produce the same validated shape; addressDetail/deliveryNote are the only
// optional pieces, matching their nullable Order columns. This is what makes
// "reject an order with no address rather than silently writing nulls"
// (Task 3) enforced by zod at the API boundary, before createBuyerOrders
// ever runs — a null address on an Order row is only ever produced by the
// pre-checkout migration backfill (see schema.prisma's comment on
// Order.recipientName), never by this code path.
export const shippingSnapshotSchema = z.object({
  recipientName: z.string().trim().min(1).max(60),
  recipientPhone: z.string().trim().min(1).max(30),
  postalCode: z.string().trim().min(1).max(20),
  address: z.string().trim().min(1).max(300),
  addressDetail: nullableText(200),
  deliveryNote: nullableText(500),
});

export const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1).max(100),
  address: shippingSnapshotSchema,
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const buyerOrderInclude = {
  listing: {
    include: {
      product: true,
      seller: { select: { code: true } },
    },
  },
  // 교환/반품 — lets /mypage/orders show an accurate per-order entry point
  // (신청 vs 상태) without a second fetch per row. See returns.ts; harmless
  // on cancelOrder/confirmPurchase's own use of this same include, since a
  // cancelled order can never carry a return request (createReturnRequest's
  // eligibility check refuses one).
  returnRequest: { select: { id: true, type: true, status: true, rejectReason: true } },
} satisfies Prisma.OrderInclude;

type BuyerOrderRecord = Prisma.OrderGetPayload<{
  include: typeof buyerOrderInclude;
}>;

export class OrderDomainError extends Error {
  constructor(
    public readonly code:
      | "ORDER_ITEM_NOT_FOUND"
      | "ORDER_QUANTITY_TOO_SMALL"
      | "ORDER_STOCK_INSUFFICIENT"
      | "ORDER_ALREADY_CANCELLED"
      | "ORDER_NOT_FOUND"
      | "CANCEL_AFTER_SHIPPING"
      | "CANCEL_REASON_REQUIRED"
      | "PURCHASE_CONFIRM_INVALID_STATUS",
    public readonly status = 409,
  ) {
    super(code);
    this.name = "OrderDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json(
    { error: "VALIDATION_ERROR", details: error.issues },
    { status: 400 },
  );
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "DUPLICATE_RESOURCE" }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof OrderDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

function toBuyerOrderView(order: BuyerOrderRecord) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    listingId: order.listingId,
    sellerId: order.sellerId,
    status: order.status,
    cancelReason: order.cancelReason,
    shippingStatus: order.shippingStatus,
    shippingStatusLabel: SHIPPING_STATUS_LABEL[order.shippingStatus],
    courier: order.courier,
    trackingNumber: order.trackingNumber,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    manufacturer: order.listing.product.manufacturer,
    model: order.listing.product.model,
    width: order.listing.product.width,
    ratio: order.listing.product.ratio,
    rim: order.listing.product.rim,
    dot: order.listing.dot,
    factoryPrice: order.listing.factoryPrice,
    unitPrice: order.unitPrice,
    quantity: order.quantity,
    extraShipping: order.extraShipping,
    shippingFee: order.shippingFee,
    total: order.unitPrice * order.quantity + order.extraShipping + order.shippingFee,
    sellerCode: order.listing.seller.code,
    orderedAt: order.orderedAt.toISOString(),
    // Shipping snapshot (Task 3). Nullable only for orders that predate this
    // column — see schema.prisma's comment on Order.recipientName. Every
    // order created through /checkout always has these populated (except
    // addressDetail/deliveryNote, which are genuinely optional).
    recipientName: order.recipientName,
    recipientPhone: order.recipientPhone,
    postalCode: order.postalCode,
    address: order.address,
    addressDetail: order.addressDetail,
    deliveryNote: order.deliveryNote,
    // 교환/반품 — null until the buyer files one (returns.ts). Once present,
    // it stays present forever (orderId is @unique on ReturnRequest), so the
    // client can render "신청" only when this is null and eligibility allows
    // it, and the request's own status otherwise.
    returnRequest: order.returnRequest
      ? {
          id: order.returnRequest.id,
          type: order.returnRequest.type,
          status: order.returnRequest.status,
          rejectReason: order.returnRequest.rejectReason,
        }
      : null,
  };
}

export type BuyerOrderView = ReturnType<typeof toBuyerOrderView>;

// Same lazy-expiry idea as CART_ITEM_TTL_MS in src/lib/server/cart.ts: this
// Render deployment is a plain web service with no cron/worker, so an unpaid
// (입금대기) order can't be expired by a background job. Instead every read
// path that lists orders (buyer/seller/admin) prunes stale 입금대기 rows in
// its own scope first. Without this, an approved buyer (or anyone abandoning
// checkout) can call POST /api/orders repeatedly and permanently hold
// Listing.stock hostage, since nothing else ever gives it back.
//
// The deadline is tracked per-order (Order.paymentDeadline) rather than as a
// flat "orderedAt + TTL" computed here, because /api/payments/toss/prepare
// can run well after order creation and must be able to extend the deadline
// for the specific orders it prepares — see prepare/route.ts.
export const UNPAID_ORDER_TTL_MS = 30 * 60 * 1000;

// Restores a cancelled/expired order's listing stock and reopens the listing
// if that restoration takes it off SOLDOUT. Shared by cancelOrder,
// expireStaleUnpaidOrders below, and the Toss webhook's reconciliation
// (src/app/api/payments/toss/webhook/route.ts) — one rule, one place, so a
// future change to how restocking works can't silently apply to only some of
// the paths that cancel an order. Must run inside the same transaction as
// the order-status flip that cancelled the order, using that same
// transaction's already-loaded listing status (callers already have it from
// their own `include: { listing: true }` read, so this deliberately takes it
// as a parameter instead of re-querying).
export async function restoreListingStockForCancelledOrder(
  tx: Prisma.TransactionClient,
  order: { listingId: string; quantity: number; listingStatus: string },
) {
  await tx.listing.update({
    where: { id: order.listingId },
    data: {
      stock: { increment: order.quantity },
      ...(order.listingStatus === "SOLDOUT" ? { status: "ACTIVE" } : {}),
    },
  });
}

// Expires every 입금대기 order matching `scope` whose paymentDeadline has
// passed: flips it to 입금전취소, restores the listing's stock, and reopens
// the listing if that stock restoration takes it off SOLDOUT. Callers scope
// this to the relevant user/seller (buyer/seller order lists) so one user's
// read never touches another user's rows; getAdminOrders passes an empty
// scope ({}) since the admin order list is intentionally global.
export async function expireStaleUnpaidOrders(scope: Prisma.OrderWhereInput) {
  const candidates = await prisma.order.findMany({
    where: {
      ...scope,
      status: ORDER_STATUS.PAYMENT_PENDING,
      paymentDeadline: { lt: new Date() },
    },
    select: { id: true },
  });

  for (const { id } of candidates) {
    // One transaction per order: each expiry only ever touches that order's
    // own row and its own listing, so nothing is gained by batching several
    // orders into one transaction, and keeping them separate means one
    // order's expiry being skipped never rolls back the others.
    const expiredOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { listing: true },
      });
      // Already moved off 입금대기 (paid, cancelled, or expired by a
      // concurrent call) between the findMany above and this transaction —
      // nothing to do.
      if (!order || order.status !== ORDER_STATUS.PAYMENT_PENDING) return null;

      // Conditional updateMany guarded on the current status is what keeps
      // this safe against a concurrent Toss confirm: confirm only ever flips
      // PAYMENT_PENDING -> PAYMENT_COMPLETED inside its own transaction and
      // re-reads order state there (see toss/confirm/route.ts), so whichever
      // of the two writes commits first wins and the other's updateMany
      // simply matches 0 rows instead of clobbering the winner.
      const expired = await tx.order.updateMany({
        where: { id, status: ORDER_STATUS.PAYMENT_PENDING },
        data: {
          status: CANCEL_STATUS.PAYMENT_BEFORE,
          cancelReason: "결제 시간 초과로 자동 취소되었습니다.",
        },
      });
      if (expired.count !== 1) return null;

      await restoreListingStockForCancelledOrder(tx, {
        listingId: order.listingId,
        quantity: order.quantity,
        listingStatus: order.listing.status,
      });

      return order;
    });

    // Fired only after the transaction above has committed — never from
    // inside it, per the rule in notify.ts. This is the buyer-facing
    // "order auto-cancelled by payment timeout" notification; notifyUser
    // swallows its own errors, so a notification failure here can never
    // undo the expiry that already committed.
    if (expiredOrder) {
      await notifyUser(expiredOrder.buyerId, "BUYER_ORDER_AUTO_CANCELLED", {
        subject: "결제 시간 초과로 주문이 취소되었습니다",
        body: `주문(${expiredOrder.id})이 결제 시간 초과로 자동 취소되었습니다. 다시 주문해 주세요.`,
      });
    }
  }
}

export async function getBuyerOrders(buyerId: string) {
  await expireStaleUnpaidOrders({ buyerId });

  const orders = await prisma.order.findMany({
    where: { buyerId },
    orderBy: { orderedAt: "desc" },
    include: buyerOrderInclude,
  });
  return orders.map(toBuyerOrderView);
}

type OrderItemInput = z.infer<typeof orderItemSchema>;

// Only listings from a seller in good standing may be ordered — a suspended
// or withdrawn seller can no longer log in to ship, so their listings must be
// excluded here even if a client bypasses the public catalog and posts an
// order request directly.
// Exported so checkout.ts's read-only shipping-fee preview (Task 3) can
// apply the exact same "who even counts as a seller" rule when looking up
// Seller.shippingFee/freeShippingThreshold for the buyer's current cart —
// one rule, one place, instead of a second definition that could drift.
export const sellerInGoodStanding = {
  status: "ACTIVE" as const,
  user: { withdrawnAt: null },
};

async function findActiveListing(tx: Prisma.TransactionClient, item: OrderItemInput) {
  const commonWhere = {
    seller: { code: item.sellerCode, ...sellerInGoodStanding },
    dot: item.dot,
    status: "ACTIVE" as const,
  };

  // The cart/product page now carries the exact listing the buyer priced and
  // clicked on. Prefer it and re-validate ownership/status/seller-code here
  // rather than trusting the client — this is what makes checkout match the
  // listing (and price) actually shown on screen instead of falling through
  // to an unordered findFirst over every listing that happens to share the
  // same product + DOT.
  if (item.listingId) {
    const byListingId = await tx.listing.findFirst({
      where: { ...commonWhere, id: item.listingId },
      include: { product: true },
    });
    if (byListingId) return byListingId;
  }

  // Deterministic fallback for older clients that don't send listingId yet:
  // order by price then id so a seller with several ACTIVE listings for the
  // same product/DOT always resolves to the same (cheapest) one instead of
  // whichever row the database happens to return first.
  const byProductId = await tx.listing.findFirst({
    where: { ...commonWhere, productId: item.tireId },
    orderBy: [{ price: "asc" }, { id: "asc" }],
    include: { product: true },
  });
  if (byProductId) return byProductId;

  return tx.listing.findFirst({
    where: {
      ...commonWhere,
      product: {
        manufacturer: item.manufacturer,
        model: item.model,
        width: item.width,
        ratio: item.ratio,
        rim: item.rim,
      },
    },
    orderBy: [{ price: "asc" }, { id: "asc" }],
    include: { product: true },
  });
}

export async function createBuyerOrders(buyerId: string, data: z.infer<typeof createOrderSchema>) {
  // Expire this buyer's own stale 입금대기 orders first, so their stock is
  // back in the pool before we check availability for the new order below —
  // otherwise a buyer who repeatedly abandons checkout would see listings as
  // sold out that are only "sold out" because their own expired orders never
  // released the stock.
  await expireStaleUnpaidOrders({ buyerId });

  // 주문번호 충돌(동시 체크아웃이 같은 당일 순번을 계산한 경우)만 재시도한다.
  // P2002 로 트랜잭션이 좌초하면 재고 차감을 포함한 모든 쓰기가 롤백된 상태라
  // 처음부터 다시 실행해도 이중 차감이 없고, 재시도한 쪽은 커밋된 상대방
  // 주문까지 세어 다음 번호를 받는다. 그 외의 P2002 나 다른 예외는 그대로
  // 던진다 — 이 루프는 채번 경합 전용이지 일반 재시도 장치가 아니다.
  let createdIds: string[] = [];
  for (let attempt = 0; ; attempt++) {
    try {
      createdIds = await runCreateOrdersTransaction();
      break;
    } catch (error) {
      const isOrderNoCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        JSON.stringify(error.meta?.target ?? "").includes("orderNo");
      if (!isOrderNoCollision || attempt >= 2) throw error;
    }
  }

  async function runCreateOrdersTransaction() {
    return prisma.$transaction(async (tx) => {
    // Pass 1 — resolve, validate and decrement stock for every item, in
    // exactly the order and with exactly the guards this always had:
    // findActiveListing's seller-in-good-standing lookup, the minOrder
    // check, the conditional updateMany stock decrement, and the SOLDOUT
    // flip. Order-row creation is deliberately deferred to pass 2 below —
    // see the Task 2 comment there for why. Splitting "validate + decrement"
    // from "create the row" doesn't change atomicity or the final committed
    // state: everything still runs inside this one transaction, so a throw
    // anywhere still rolls back every write made so far, exactly as before.
    const resolvedItems: { item: OrderItemInput; listing: NonNullable<Awaited<ReturnType<typeof findActiveListing>>> }[] = [];

    for (const item of data.items) {
      const listing = await findActiveListing(tx, item);
      if (!listing) throw new OrderDomainError("ORDER_ITEM_NOT_FOUND", 404);
      if (item.quantity < listing.minOrder) {
        throw new OrderDomainError("ORDER_QUANTITY_TOO_SMALL");
      }

      const updated = await tx.listing.updateMany({
        where: {
          id: listing.id,
          status: "ACTIVE",
          stock: { gte: item.quantity },
        },
        data: { stock: { decrement: item.quantity } },
      });
      if (updated.count !== 1) {
        throw new OrderDomainError("ORDER_STOCK_INSUFFICIENT");
      }

      const remainingListing = await tx.listing.findUnique({
        where: { id: listing.id },
        select: { stock: true },
      });
      if (remainingListing?.stock === 0) {
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: "SOLDOUT" },
        });
      }

      resolvedItems.push({ item, listing });
    }

    // Task 2 — 배송비. Shipping is charged once per seller per checkout, not
    // once per line item, so the fee has to be resolved from each seller's
    // *combined* goods subtotal across every item of theirs in this
    // checkout — which is only known once every item above has resolved to
    // a real listing. goodsAmount uses listing.price (the DB's own price at
    // order time), never item.price from the request body, for the same
    // reason unitPrice below always has: the client cannot be trusted with
    // any price component.
    const sellerSubtotals = new Map<string, number>();
    for (const { item, listing } of resolvedItems) {
      const lineGoodsAmount = listing.price * item.quantity;
      sellerSubtotals.set(listing.sellerId, (sellerSubtotals.get(listing.sellerId) ?? 0) + lineGoodsAmount);
    }

    const sellerPolicies = await tx.seller.findMany({
      where: { id: { in: Array.from(sellerSubtotals.keys()) } },
      select: { id: true, shippingFee: true, freeShippingThreshold: true },
    });
    const sellerFees = new Map<string, number>(
      sellerPolicies.map((seller) => [
        seller.id,
        resolveSellerShippingFee(seller, sellerSubtotals.get(seller.id) ?? 0),
      ]),
    );

    // 주문번호 채번. KST 날짜 + 당일 순번(YYYYMMDD-0001) — 내부 cuid 를
    // 화면에 그대로 내보내던 것을 대체한다. 당일 건수는 이 트랜잭션 안에서
    // 세므로, 동시 체크아웃 두 개가 같은 번호를 계산하면 orderNo 의 unique
    // 제약이 한쪽을 P2002 로 좌초시키고(재고 차감까지 함께 롤백),
    // createBuyerOrders 바깥의 재시도 루프가 새로 센다. 날짜를 KST 로 하는
    // 이유는 백필 마이그레이션과 같은 달력을 써야 하기 때문 — UTC 면 한국
    // 새벽 주문이 전날 번호를 받는다.
    const kstDatePrefix = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })
      .format(new Date())
      .replace(/-/g, "");
    let orderSeq = await tx.order.count({ where: { orderNo: { startsWith: `${kstDatePrefix}-` } } });

    // Pass 2 — create the Order rows. A per-seller fee has to land on
    // per-listing Order rows without being multiplied by however many
    // listings that seller happens to have in this cart: the first Order row
    // created for a given seller (in item order) absorbs that seller's whole
    // resolved fee, and every later row for the same seller in this same
    // checkout gets 0. So for any seller with N orders from one checkout,
    // sum(shippingFee) = fee + 0*(N-1) = fee exactly once — never fee*N.
    const sellerCharged = new Set<string>();
    const ids: string[] = [];

    for (const { item, listing } of resolvedItems) {
      const isFirstOrderForSeller = !sellerCharged.has(listing.sellerId);
      if (isFirstOrderForSeller) sellerCharged.add(listing.sellerId);

      orderSeq += 1;
      const order = await tx.order.create({
        data: {
          orderNo: `${kstDatePrefix}-${String(orderSeq).padStart(4, "0")}`,
          buyerId,
          listingId: listing.id,
          sellerId: listing.sellerId,
          quantity: item.quantity,
          unitPrice: listing.price,
          // Server-derived, not item.extraShipping from the request body —
          // see resolveExtraShipping (pricing.ts) for why the client's value
          // is never trusted here.
          extraShipping: resolveExtraShipping(),
          // Server-derived from Seller rows above (resolveSellerShippingFee),
          // never from the request body — see pricing.ts.
          shippingFee: isFirstOrderForSeller ? (sellerFees.get(listing.sellerId) ?? 0) : 0,
          status: ORDER_STATUS.PAYMENT_PENDING,
          shippingStatus: "PREPARING",
          courier: null,
          trackingNumber: null,
          paymentDeadline: new Date(Date.now() + UNPAID_ORDER_TTL_MS),
          // Shipping snapshot (Task 3) — zod already guarantees data.address
          // is present and its required fields non-empty (createOrderSchema),
          // so every order created here always carries a real address; only
          // rows that predate this column are ever null (backfilled by the
          // migration from the buyer's User record at that time).
          recipientName: data.address.recipientName,
          recipientPhone: data.address.recipientPhone,
          postalCode: data.address.postalCode,
          address: data.address.address,
          addressDetail: data.address.addressDetail ?? null,
          deliveryNote: data.address.deliveryNote ?? null,
        },
      });
      ids.push(order.id);
    }

    return ids;
    });
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: createdIds } },
    include: buyerOrderInclude,
    orderBy: { orderedAt: "desc" },
  });

  // Seller-facing "new order received" notification, fired only after the
  // transaction above has committed (never from inside it — see notify.ts).
  // One order-creation request can span several sellers (a buyer's cart may
  // mix listings from different sellers), so notify each affected seller
  // once rather than once per order line.
  const sellerIds = Array.from(new Set(orders.map((order) => order.sellerId)));
  for (const sellerId of sellerIds) {
    const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { userId: true } });
    if (!seller) continue;
    await notifyUser(seller.userId, "SELLER_ORDER_RECEIVED", {
      subject: "새 주문이 접수되었습니다",
      body: "새로운 주문이 접수되었습니다. 판매자 페이지에서 주문 내역을 확인해 주세요.",
    });
  }

  return orders.map(toBuyerOrderView);
}

type CancelActor =
  | { kind: "BUYER"; userId: string }
  | { kind: "SELLER"; sellerId: string }
  | { kind: "ADMIN"; userId: string };

const cancelledStatusValues = Object.values(CANCEL_STATUS);

// Sticky failure marker (Payment.refundReason). Once ANY automated refund
// attempt for a payment fails, every later cancellation on that same payment
// preserves this marker instead of overwriting it with its own optimistic
// label (see the read of it inside cancelOrder's transaction below), and
// settleOrderRefundViaToss refuses to clear refundRequiredAt — or flip the
// payment to CANCELED — while it is present (see the guarded updateMany
// there). This is what makes Task 6's "only clear it for the portion
// genuinely refunded" hold even across several cancellations on one payment:
// this codebase has no per-order ledger of which specific slice of
// refundAmount actually left via Toss, so once one slice is known to be
// stuck, the whole payment permanently defers to manual reconciliation
// (README's 운영 가이드) rather than risk a later, unrelated success quietly
// clearing the "환불 필요" badge while the earlier failure's money is still
// sitting un-refunded.
//
// Exported so returns.ts's completeReturnRequest can apply the same
// never-paper-over-an-unresolved-failure rule when a RETURN completes on a
// payment that already carries this marker from an earlier cancellation —
// see that function for details.
export const AUTO_REFUND_TOSS_FAILURE_REASON = "AUTO_REFUND_FAILED_NEEDS_MANUAL_TOSS_CANCEL";

async function cancelTossPaymentForRefund(
  paymentKey: string | null,
  // null = cancel whatever balance Toss still holds, by omitting cancelAmount
  // from the request. Only used when this cancellation leaves no active order
  // on the payment — see settleOrderRefundViaToss.
  cancelAmount: number | null,
  reason: string,
  idempotencyKey: string,
): Promise<boolean> {
  if (!paymentKey) return false;
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    console.error("TOSS_PAYMENT_CANCEL_SECRET_KEY_MISSING", { paymentKey });
    return false;
  }
  const authorization = Buffer.from(`${secretKey}:`).toString("base64");
  try {
    const response = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
        // Toss dedupes cancel requests by this header (confirmed:
        // https://docs.tosspayments.com/reference/using-api/idempotency-key
        // — honoured on all POST APIs, max 300 chars), so a retried call
        // after a network timeout (where we can't tell if the first call
        // actually landed) can't double-refund the same cancellation; a
        // repeat with the same key replays the first response rather than
        // re-executing. That dedup window is only 15 days from first use —
        // a retry of this exact cancellation attempted after 15 days would
        // NOT be deduped and could double-cancel. Not a concern for the
        // immediate retry this key is designed for (see the call site in
        // settleOrderRefundViaToss, which runs once right after the
        // triggering DB transaction commits), but worth knowing before this
        // key is ever reused for a long-delayed manual retry.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        cancelReason: reason,
        // A cancellation that still leaves other orders live sends its own
        // exact amount, so only that slice comes back. The one that leaves
        // nothing active passes null and omits the field entirely, which
        // tells Toss to cancel the whole remaining balance.
        //
        // That difference is not cosmetic. Sending an explicit amount for
        // the last order too makes Toss record it as yet another *partial*
        // cancellation, so the payment sits at PARTIAL_CANCELED in the Toss
        // console even once its balance reaches 0 — observed on a real test
        // payment, where a fully refunded 6,000원 order still displayed as
        // 부분취소. An operator reconciling in that console cannot tell a
        // fully-refunded payment from one still owing money.
        //
        // Omitting it is also self-healing: the remaining balance includes
        // any earlier slice whose own cancel call failed, so the final
        // cancellation sweeps up what the sticky failure marker would
        // otherwise have left for a human. Toss can never return more than
        // it holds, so this cannot over-refund.
        ...(cancelAmount === null ? {} : { cancelAmount }),
        // Every product this marketplace sells is a taxable tire — nothing
        // in Product/Listing carries a tax-exempt flag, so the tax-free
        // portion of any cancellation here is always 0. Toss's own docs call
        // out that partial cancellation of a CARD payment is NOT permitted
        // when a tax-exempt amount is present (their example is 컵보증금);
        // this app is card-only and 0-tax-free today, so partial cancel is
        // permitted — but if this app ever sells a tax-exempt line item,
        // this hardcoded 0 (and therefore partial cancellation itself)
        // stops being safe without per-order tax tracking that does not
        // exist in this schema.
        taxFreeAmount: 0,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("TOSS_PAYMENT_CANCEL_REQUEST_FAILED", { paymentKey, error });
    return false;
  }
}

// Runs after the DB transaction that recorded refundRequiredAt has already
// committed — an external HTTP call must never happen inside a Prisma
// transaction (see cancelOrder). Fires for EVERY order cancelled off a DONE
// payment now, not just the last remaining one: each cancellation submits
// its own cancelledOrderAmount as Toss's cancelAmount (Task 1), so a buyer
// who cancels one of three items gets that item's money back immediately
// instead of waiting for someone to notice the "환불 필요" badge and process
// it by hand in the Toss console.
//
// Why the old "last order omits cancelAmount to cancel the whole remaining
// balance" shape is gone: that was correct only in a world where NO earlier
// order on the same payment had ever been auto-refunded, so the entire
// original amount was still sitting uncancelled on Toss's side right up
// until the last order was cancelled. Now that earlier orders may already
// have been individually refunded via Toss, Toss's real remaining balance by
// the time the last order is cancelled is just that order's own amount —
// unless an earlier partial call actually failed, in which case more than
// that is still outstanding, and there is no way to tell which case we're in
// from here without a per-order Toss ledger this schema doesn't have.
// Sending a specific, known, exact amount is correct in the first case and
// merely incomplete (never wrong/over-refunding) in the second — Toss will
// simply reject a cancelAmount that exceeds its real balance rather than
// silently doing the wrong thing. "Omit cancelAmount" would instead risk
// either double-refunding money that already went out via an earlier
// successful partial call, or refunding an unrelated earlier chunk together
// with this order's — both worse than the exact-amount approach.
//
// refundRequiredAt/refundReason/refundAmount stay the durable record an
// operator acts on (README's 운영 가이드) for whatever this call does not
// resolve.
async function settleOrderRefundViaToss(
  paymentId: string,
  paymentKey: string | null,
  orderId: string,
  cancelAmount: number,
  refundRequiredAt: Date,
  isFullRefund: boolean,
) {
  const reasonWhenSubmitting = isFullRefund ? "ALL_ORDERS_ON_PAYMENT_CANCELLED" : "ORDER_CANCELED_AFTER_PAYMENT";
  try {
    const tossCancelSucceeded = await cancelTossPaymentForRefund(
      paymentKey,
      // Last active order on this payment -> cancel Toss's whole remaining
      // balance rather than this order's slice, so the payment lands on
      // CANCELED instead of PARTIAL_CANCELED. See cancelTossPaymentForRefund.
      isFullRefund ? null : cancelAmount,
      reasonWhenSubmitting,
      // Stable per order (not per attempt): a retry of this exact call for
      // the exact same order replays Toss's first response instead of
      // cancelling twice. See the Idempotency-Key comment above for the
      // 15-day validity window this relies on.
      `order-cancel-refund:${orderId}`,
    );

    if (tossCancelSucceeded) {
      // Only clear refundRequiredAt — and, for the order that locally leaves
      // nothing else active on the payment, only flip Payment to CANCELED —
      // if BOTH hold right now:
      //   1. Nothing newer has claimed this payment's refund flag since we
      //      set it (refundRequiredAt still equals the exact timestamp our
      //      own transaction wrote). Otherwise a concurrent cancellation of
      //      a *different* order on the same payment could have its own
      //      still-pending obligation silently wiped out by our success.
      //   2. No earlier cancellation on this same payment ever recorded the
      //      sticky AUTO_REFUND_TOSS_FAILURE_REASON marker — see its
      //      definition above for why a success here must never clear a
      //      still-unresolved earlier failure's flag.
      const updated = await prisma.payment.updateMany({
        where: {
          id: paymentId,
          refundRequiredAt,
          refundReason: { not: AUTO_REFUND_TOSS_FAILURE_REASON },
        },
        data: {
          refundRequiredAt: null,
          refundReason: isFullRefund ? "FULLY_REFUNDED_VIA_TOSS_CANCEL" : "PARTIALLY_REFUNDED_VIA_TOSS_CANCEL",
          ...(isFullRefund ? { status: "CANCELED" as const } : {}),
        },
      });
      if (updated.count !== 1) {
        // The cancelAmount really did reach Toss (tossCancelSucceeded is
        // true) — it's only the payment-level flag that couldn't be safely
        // cleared from here, because it was superseded by a newer
        // cancellation or a prior failure is still outstanding. Leave it for
        // whichever later settle (or a human) can actually resolve the whole
        // payment; log so this isn't silently invisible.
        console.error("TOSS_PAYMENT_CANCEL_SETTLED_BUT_FLAG_NOT_CLEARED", { paymentId, orderId, isFullRefund });
      }
      return;
    }

    // Toss was not actually charged back. Mark the payment as needing manual
    // reconciliation (sticky — see AUTO_REFUND_TOSS_FAILURE_REASON above),
    // but only if nothing newer already owns the flag; a concurrent
    // cancellation that has since moved this payment on should not be
    // stamped with our stale failure note.
    await prisma.payment.updateMany({
      where: { id: paymentId, refundRequiredAt },
      data: { refundReason: AUTO_REFUND_TOSS_FAILURE_REASON },
    });
  } catch (error) {
    console.error("TOSS_PAYMENT_CANCEL_SETTLEMENT_FAILED", { paymentId, paymentKey, orderId, error });
  }
}

export async function cancelOrder(
  orderId: string,
  actor: CancelActor,
  reason?: string,
) {
  if (actor.kind === "SELLER" && !reason?.trim()) {
    throw new OrderDomainError("CANCEL_REASON_REQUIRED", 400);
  }

  const { order: updated, refundCandidate } = await prisma.$transaction(async (tx) => {
    let refundCandidate:
      | {
          paymentId: string;
          paymentKey: string | null;
          cancelAmount: number;
          refundRequiredAt: Date;
          isFullRefund: boolean;
        }
      | null = null;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { listing: true },
    });
    if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", 404);

    const belongsToActor =
      (actor.kind === "BUYER" && order.buyerId === actor.userId) ||
      (actor.kind === "SELLER" && order.sellerId === actor.sellerId) ||
      actor.kind === "ADMIN";
    if (!belongsToActor) throw new OrderDomainError("ORDER_NOT_FOUND", 404);
    if (isCancelledOrderStatus(order.status)) {
      throw new OrderDomainError("ORDER_ALREADY_CANCELLED");
    }
    // Both axes have to be checked, because each one catches a case the other
    // misses:
    //  - order.status (rank) is the axis that can never regress once
    //    advanced, whereas an admin may reset shippingStatus to an earlier
    //    value without limit (see updateAdminShipping). Gating on status
    //    alone stops an admin correcting a shippingStatus mistake from
    //    accidentally reopening cancellation on an order that truly shipped,
    //    and blocks cancellation at 구매확정 for free (rank 6 > 배송중's 4).
    //  - shippingStatus still has to be checked because order.status was NOT
    //    kept in lock-step with shipping before the 연동 change: every order
    //    that already exists carries status 입금완료 (rank 1) no matter how
    //    far its shipping got. The status backfill migration realigns the
    //    rows it safely can, but anything it deliberately skips (e.g. an
    //    unpaid-yet-shipped order) would otherwise become cancellable here
    //    despite having physically shipped — restoring stock for a tire that
    //    already left the warehouse.
    const shippedByStatusRank =
      orderStatusRank[order.status as OrderStatusValue] >= orderStatusRank[ORDER_STATUS.SHIPPING];
    const shippedByShippingStatus =
      order.shippingStatus === "SHIPPED" || order.shippingStatus === "DELIVERED";
    if (actor.kind !== "ADMIN" && (shippedByStatusRank || shippedByShippingStatus)) {
      throw new OrderDomainError("CANCEL_AFTER_SHIPPING");
    }

    const nextStatus =
      order.status === ORDER_STATUS.PAYMENT_PENDING
        ? CANCEL_STATUS.PAYMENT_BEFORE
        : CANCEL_STATUS.PAYMENT_AFTER;
    // QA 발견: 구매자 셀프 취소만 취소 사유가 비어 있었다. 자동 만료·판매자
    // 취소는 항상 사유를 남기는데(판매자는 필수이기까지 하다) 구매자 취소는
    // 화면이 사유를 안 받으므로 null 로 남아, 같은 목록에서 이 행만 "취소
    // 사유" 줄이 사라졌다. 사유가 없으면 행위자별 기본 문구를 기록해 취소된
    // 모든 주문이 왜 취소됐는지 답을 갖게 한다.
    const defaultReason =
      actor.kind === "BUYER"
        ? "구매자 요청으로 취소되었습니다."
        : actor.kind === "ADMIN"
          ? "관리자에 의해 취소되었습니다."
          : null; // SELLER 는 위에서 사유가 필수라 여기 도달하지 않는다.
    const markedCancelled = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: nextStatus,
        cancelReason: reason?.trim() || defaultReason,
      },
    });
    if (markedCancelled.count !== 1) {
      throw new OrderDomainError("ORDER_ALREADY_CANCELLED");
    }

    await restoreListingStockForCancelledOrder(tx, {
      listingId: order.listingId,
      quantity: order.quantity,
      listingStatus: order.listing.status,
    });

    // Cancelling an already-paid order (입금후취소) doesn't touch its Payment
    // by itself — the card was already charged, so the refund has to be
    // tracked (and, when nothing is left on the payment, actually reversed)
    // or it just disappears from the system.
    //
    // Only DB writes happen in this transaction. Calling Toss's cancel API
    // here would mean an external HTTP call that Postgres cannot roll back:
    // if Toss actually processed the cancellation but a later statement in
    // this same transaction then failed (or the transaction hit its
    // timeout), the refund would have gone out for real while the order
    // stayed un-cancelled, stock un-restored, and Payment stuck at DONE.
    // So the transaction only ever records "a refund is owed" durably;
    // cancelOrder calls Toss afterward, once that record is committed.
    if (nextStatus === CANCEL_STATUS.PAYMENT_AFTER && order.paymentId) {
      const payment = await tx.payment.findUnique({ where: { id: order.paymentId } });
      if (payment && payment.status === "DONE") {
        // 정산 후 취소 클로백: 이 주문이 이미 판매자에게 정산·지급된 뒤
        // 취소되는 경우(가능한 경로는 ADMIN 뿐 — 비관리자는 배송중 이후
        // 취소가 막혀 있고, 정산 대상이 되려면 최소 결제 승인까지는 끝나
        // 있어야 한다), 아래의 구매자 환불 추적(Payment.refundRequiredAt)과
        // 별개로 판매자가 이미 받아간 돈을 되돌려야 한다. returns.ts 의 반품
        // 완료 클로백과 동일한 헬퍼 사용 — payout.ts 의
        // createSettlementClawbackForOrder 참고. 이미 반품완료로 취소 상태가
        // 된 주문은 위쪽 isCancelledOrderStatus 가드로 이 함수에 재진입할 수
        // 없으므로 두 호출부가 같은 주문에 대해 중복 생성하는 경로는
        // 구조적으로 없고, SettlementAdjustment.orderId 의 @unique 가 최후
        // 안전망이다. 아래 배송비 승계 로직과는 서로 배타적으로 동작한다 —
        // 승계는 이 주문이 미정산(settlementId === null)일 때만 일어나므로
        // 같은 배송비가 승계와 클로백 양쪽에서 동시에 처리될 수 없다.
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
            "ORDER_CANCELLED_AFTER_SETTLEMENT",
          );
        }

        // 배송비 승계 (LEAK A 수정): 이 주문이 배송비를 짊어지고 있는데
        // (shippingFee > 0) 같은 결제·같은 판매자의 다른 주문이 아직 살아
        // 있다면, 그 배송비는 여전히 실제로 나갈 배송 건에 대한 몫이다 —
        // 취소된 이 주문 하나만 환불 대상에서 배송비를 빼고, 대신 살아남은
        // 형제 주문(가장 먼저 생성된 것, orderedAt asc)에게 그 금액을
        // 그대로 넘긴다. 형제가 없다면(이 판매자 몫으로 남은 게 없다면)
        // 기존 그대로 배송비까지 전액 환불한다. shippingFee 가 실제로
        // heir 행으로 옮겨가므로, heir 를 나중에 취소해도 이 로직이 다시
        // 돌며 그 다음 heir 를 찾거나(마지막이면) 배송비를 정상 환불한다.
        // 승계는 "아직 정산되지 않은" 주문들 사이에서만 한다. 취소되는
        // 주문이 이미 정산됐다면(settlementId != null) 그 배송비는 이미
        // 판매자에게 지급된 몫이므로, 이를 heir 로 옮기면 heir 가 정산될 때
        // 판매자가 같은 배송비를 두 번 받는다. 그 경우 승계하지 않고 기존
        // 동작(환불에 배송비 포함)에 맡긴다. heir 역시 미정산(settlementId
        // null)이어야 그 배송비를 실제 정산으로 이어받는다 — 이미 정산된
        // 주문은 정산 후보 조회에서 settlementId: null 로 제외되므로(payout.ts
        // confirmPayout), 그런 주문으로 옮기면 배송비가 그냥 사라진다.
        let refundableShippingFee = order.shippingFee;
        if (order.shippingFee > 0 && order.settlementId === null) {
          const feeHeir = await tx.order.findFirst({
            where: {
              paymentId: payment.id,
              sellerId: order.sellerId,
              id: { not: orderId },
              status: { notIn: cancelledStatusValues },
              settlementId: null,
            },
            orderBy: { orderedAt: "asc" },
          });
          if (feeHeir) {
            await tx.order.update({
              where: { id: feeHeir.id },
              data: { shippingFee: { increment: order.shippingFee } },
            });
            refundableShippingFee = 0;
          }
        }
        const cancelledOrderAmount =
          order.unitPrice * order.quantity + order.extraShipping + refundableShippingFee;
        // nonSettleableStatusValues (NOT the full cancelledStatusValues):
        // the question here is "does any money on this payment still
        // legitimately belong to a sale", and an EXCHANGE_COMPLETED sibling
        // is exactly that — the buyer kept the goods and its money must stay
        // charged. Counting it as inactive (the full set's answer) would
        // flip isFullRefund to true and settleOrderRefundViaToss would then
        // submit a null cancelAmount — a FULL Toss cancel that refunds the
        // exchanged order's money to a buyer who keeps the goods. A
        // RETURN_COMPLETED sibling stays "inactive" on purpose: its money is
        // refund-owed anyway, so letting the full cancel sweep it up pays a
        // debt that already exists.
        const remainingActiveOrders = await tx.order.count({
          where: {
            paymentId: payment.id,
            id: { not: orderId },
            status: { notIn: nonSettleableStatusValues },
          },
        });
        // isFullRefund only ever means "this is the last active order on the
        // payment, by our own row count" — a purely local fact. It does NOT
        // by itself mean the whole original payment amount is still
        // uncancelled on Toss's side; see settleOrderRefundViaToss for why
        // the Toss call this triggers is shaped the same way regardless.
        const isFullRefund = remainingActiveOrders === 0;

        // Over-refund guard (never ask Toss to cancel more than this
        // payment could still owe, by our own bookkeeping). In the healthy
        // case cancelledOrderAmount always equals exactly the gap between
        // payment.amount and refundAmount recorded so far, because every
        // order's price is accounted for exactly once, right here, the only
        // place that increments refundAmount. This clamp only bites if that
        // invariant has already drifted — and even then it can only shrink
        // what we ask Toss to cancel, never grow it.
        //
        // Deliberately NOT paired with a live GET of Toss's own
        // balanceAmount before every cancel: that would add a network round
        // trip to every single order cancellation. Toss's /cancel endpoint
        // itself already rejects a cancelAmount exceeding its real
        // remaining balance, so an operator who separately cancelled
        // something by hand in the Toss console (today's documented manual
        // fallback, README's 운영 가이드) gets a *rejected* automated call
        // here rather than a silently wrong one — the failure path in
        // settleOrderRefundViaToss keeps that durably recorded for the same
        // operator to reconcile, which is the safer, under-refund-not-
        // over-refund outcome this change is required to prefer. Toss's
        // authoritative balanceAmount is still consulted asynchronously,
        // for exactly this kind of console-side drift, by the webhook route
        // (see its PARTIAL_CANCELED/CANCELED handling) — duplicating that
        // synchronously on every cancel here would be redundant defense at
        // a real latency cost for a case that is already covered.
        const owedSoFar = payment.refundAmount;
        const localRemainingBalance = Math.max(0, payment.amount - owedSoFar);
        const cancelAmount = Math.min(cancelledOrderAmount, localRemainingBalance);
        if (cancelAmount < cancelledOrderAmount) {
          console.error("TOSS_REFUND_AMOUNT_CLAMPED_LOCAL_BALANCE_DRIFT", {
            paymentId: payment.id,
            orderId,
            cancelledOrderAmount,
            localRemainingBalance,
          });
        }

        const refundRequiredAt = new Date();
        // Never let a fresh cancellation's optimistic label paper over an
        // already-recorded, unresolved Toss failure on this same payment —
        // see AUTO_REFUND_TOSS_FAILURE_REASON's definition for why that
        // record has to survive every later cancellation until a human
        // resolves it.
        const hasUnresolvedAutoRefundFailure = payment.refundReason === AUTO_REFUND_TOSS_FAILURE_REASON;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundRequiredAt,
            refundReason: hasUnresolvedAutoRefundFailure
              ? AUTO_REFUND_TOSS_FAILURE_REASON
              : isFullRefund
                ? "ALL_ORDERS_ON_PAYMENT_CANCELLED"
                : "ORDER_CANCELED_AFTER_PAYMENT",
            refundAmount: { increment: cancelledOrderAmount },
          },
        });

        // Only ever attempt the Toss call for a positive amount — a
        // clamped-to-zero cancelAmount means the guard above already
        // decided there is nothing left to safely ask Toss for; the
        // transaction's write above still leaves refundRequiredAt set for a
        // human to look at that drift.
        if (cancelAmount > 0) {
          refundCandidate = {
            paymentId: payment.id,
            paymentKey: payment.paymentKey,
            cancelAmount,
            refundRequiredAt,
            isFullRefund,
          };
        }
      }
    }

    if (actor.kind === "ADMIN") {
      await tx.adminActionLog.create({
        data: {
          adminId: actor.userId,
          action: "CANCEL_ORDER",
          targetType: "ORDER",
          targetId: orderId,
          reason: reason?.trim() || null,
        },
      });
    }

    const cancelledOrder = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: buyerOrderInclude,
    });
    return { order: cancelledOrder, refundCandidate };
  }); // default timeout is fine now that no external call runs inside the tx

  if (refundCandidate) {
    await settleOrderRefundViaToss(
      refundCandidate.paymentId,
      refundCandidate.paymentKey,
      orderId,
      refundCandidate.cancelAmount,
      refundCandidate.refundRequiredAt,
      refundCandidate.isFullRefund,
    );
  }

  return toBuyerOrderView(updated);
}

// Task 2 — 구매확정: buyer-initiated, moves a 배송완료 order to 구매확정. Only
// valid from 배송완료 and only for the order's own buyer (mirrors the
// ownership check in cancelOrder's belongsToActor). Once this succeeds,
// cancelOrder's guard above refuses to cancel the order for any non-admin
// actor — rank(구매확정) sits above rank(배송중).
export async function confirmPurchase(orderId: string, buyerId: string) {
  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: orderId } });
    if (!existing || existing.buyerId !== buyerId) {
      throw new OrderDomainError("ORDER_NOT_FOUND", 404);
    }
    if (existing.status !== ORDER_STATUS.SHIPPING_COMPLETED) {
      throw new OrderDomainError("PURCHASE_CONFIRM_INVALID_STATUS");
    }

    // Conditional updateMany guarded on the current status — same pattern as
    // cancelOrder/expireStaleUnpaidOrders — so a confirm racing a concurrent
    // cancel or shipping override can't clobber the other; whichever commits
    // first wins and the other matches 0 rows instead of overwriting it.
    const confirmed = await tx.order.updateMany({
      where: { id: orderId, status: ORDER_STATUS.SHIPPING_COMPLETED },
      data: { status: ORDER_STATUS.PURCHASE_CONFIRMED },
    });
    if (confirmed.count !== 1) {
      throw new OrderDomainError("PURCHASE_CONFIRM_INVALID_STATUS");
    }

    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: buyerOrderInclude });
  });

  return toBuyerOrderView(order);
}

export function shippingStatusValue(status: ShippingStatus) {
  return SHIPPING_STATUS_LABEL[status];
}

export type OrderItem = CartItem;
