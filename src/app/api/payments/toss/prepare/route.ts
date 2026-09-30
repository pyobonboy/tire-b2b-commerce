import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ORDER_STATUS } from "@/lib/order-status";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/guard";
import { UNPAID_ORDER_TTL_MS } from "@/lib/server/orders";
import { resolveSellerShippingFee } from "@/lib/server/pricing";

export const runtime = "nodejs";

const preparePaymentSchema = z.object({
  orderIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "DUPLICATE_ORDER_IDS"),
});

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  const parsed = preparePaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const clientKey = process.env.TOSS_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.json({ error: "TOSS_CLIENT_KEY_MISSING" }, { status: 503 });
  }

  const { orderIds } = parsed.data;
  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      buyerId: auth.session.user.id,
    },
    include: { listing: { include: { product: true } } },
  });

  const areValidOrders =
    orders.length === orderIds.length &&
    orders.every((order) => order.status === ORDER_STATUS.PAYMENT_PENDING);
  if (!areValidOrders) {
    return NextResponse.json(
      { error: "ORDERS_MUST_BE_OWNED_AND_PAYMENT_PENDING" },
      { status: 400 },
    );
  }

  // shippingFee (Task 2) is charged exactly like extraShipping already was —
  // both are per-order price components snapshotted server-side, never
  // supplied by the client — so both fold into the amount actually charged
  // via Toss. See src/lib/server/pricing.ts and createBuyerOrders
  // (src/lib/server/orders.ts) for where shippingFee is resolved.
  //
  // amount itself is computed further below, INSIDE the transaction, after
  // shippingFee has been re-resolved for exactly the orders being prepared
  // (see the LEAK B comment there) — computing it here from the pre-fetched
  // `orders` would use whatever shippingFee happened to be frozen onto each
  // row at checkout time, which can under-count a real shipment (partial
  // prepare, or the fee-bearing sibling was cancelled first).

  const orderName = orders.length === 1 ? "타이어" : `타이어 외 ${orders.length - 1}건`;

  try {
    const { payment, amount } = await prisma.$transaction(async (tx) => {
      // Re-preparing payment for orders that already carry a paymentId (tab
      // reopened, page refreshed) would otherwise leave the earlier READY
      // Payment orphaned: it can still be approved by Toss later, but by then
      // these orders point at the new payment and the confirm route's
      // updateMany affects 0 rows, so the card is charged with no order to
      // show for it. Close out any such stale READY payment first.
      const priorPaymentIds = Array.from(
        new Set(orders.flatMap((order) => (order.paymentId ? [order.paymentId] : []))),
      );
      if (priorPaymentIds.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: priorPaymentIds }, status: "READY" },
          data: { status: "CANCELED", failReason: "SUPERSEDED_BY_NEW_PAYMENT_PREPARE" },
        });
      }

      // Task 2 — 배송비 재계산 (LEAK B 수정). createBuyerOrders 는 체크아웃
      // 시점에 만들어지는 "그 판매자의 모든 주문"을 기준으로 배송비를
      // 판매자당 한 번만 계산해 그중 첫 주문 행에 몰아준다. 하지만 이후
      // buyer 가 그 판매자 몫 중 일부만 결제하려 하거나(3건 생성, 2건만
      // prepare), 배송비를 짊어진 주문이 결제 전에 먼저 취소돼 버리면,
      // 지금 prepare 되는 주문 집합만 놓고 보면 그 판매자의 배송비 합이
      // 0으로 사라져 있을 수 있다 — 실제로는 배송이 나가는데 배송비를
      // 못 받는 셈이다. 그래서 여기서 "지금 결제되는 주문들만"을 대상으로
      // 판매자별 배송비를 다시 계산해 다시 써 넣는다 — createBuyerOrders와
      // 완전히 같은 규칙(판매자별 combined 상품 소계로 resolveSellerShippingFee
      // 호출, 결과는 그 판매자의 첫 주문(orderedAt asc)에만 싣고 나머지는 0)
      // 이며, 같은 Payment 생성 트랜잭션 안에서 실행해 이 아래에서 계산하는
      // amount 와 DB에 실제로 반영되는 shippingFee 가 항상 일치하게 한다 —
      // confirm 라우트는 DB에서 다시 합산하므로 이렇게 해야 서로 어긋나지
      // 않는다.
      const ordersBySeller = new Map<string, typeof orders>();
      for (const order of orders) {
        const sellerOrders = ordersBySeller.get(order.sellerId) ?? [];
        sellerOrders.push(order);
        ordersBySeller.set(order.sellerId, sellerOrders);
      }

      const sellerPolicies = await tx.seller.findMany({
        where: { id: { in: Array.from(ordersBySeller.keys()) } },
        select: { id: true, shippingFee: true, freeShippingThreshold: true },
      });
      const sellerPolicyById = new Map(sellerPolicies.map((policy) => [policy.id, policy]));

      // orderId -> shippingFee this order should carry now that only the
      // orders actually being prepared are in play.
      const resolvedShippingFeeByOrderId = new Map<string, number>();
      for (const [sellerId, sellerOrders] of ordersBySeller) {
        const policy = sellerPolicyById.get(sellerId);
        // 상품 소계만 — extraShipping/shippingFee 는 제외. createBuyerOrders의
        // sellerSubtotals 계산과 동일한 기준.
        const goodsSubtotal = sellerOrders.reduce(
          (sum, order) => sum + order.unitPrice * order.quantity,
          0,
        );
        const fee = policy ? resolveSellerShippingFee(policy, goodsSubtotal) : 0;
        const sortedSellerOrders = [...sellerOrders].sort(
          (a, b) => a.orderedAt.getTime() - b.orderedAt.getTime(),
        );
        sortedSellerOrders.forEach((order, index) => {
          resolvedShippingFeeByOrderId.set(order.id, index === 0 ? fee : 0);
        });
      }

      for (const order of orders) {
        const resolvedFee = resolvedShippingFeeByOrderId.get(order.id) ?? 0;
        if (resolvedFee !== order.shippingFee) {
          await tx.order.update({
            where: { id: order.id },
            data: { shippingFee: resolvedFee },
          });
        }
      }

      const amount = orders.reduce(
        (total, order) =>
          total +
          order.unitPrice * order.quantity +
          order.extraShipping +
          (resolvedShippingFeeByOrderId.get(order.id) ?? order.shippingFee),
        0,
      );
      if (amount <= 0) {
        throw new Error("INVALID_PAYMENT_AMOUNT");
      }

      const createdPayment = await tx.payment.create({
        data: {
          tossOrderId: `order_${randomUUID()}`,
          buyerId: auth.session.user.id,
          amount,
          status: "READY",
        },
      });

      const updatedOrders = await tx.order.updateMany({
        where: {
          id: { in: orderIds },
          buyerId: auth.session.user.id,
          status: ORDER_STATUS.PAYMENT_PENDING,
        },
        data: {
          paymentId: createdPayment.id,
          // Refresh the lazy-expiry deadline (see UNPAID_ORDER_TTL_MS in
          // src/lib/server/orders.ts) to now + TTL. Without this, a buyer who
          // opens the Toss payment sheet near the end of the original
          // deadline could have their order expired by expireStaleUnpaidOrders
          // while the payment sheet is still open, out from under them.
          paymentDeadline: new Date(Date.now() + UNPAID_ORDER_TTL_MS),
        },
      });

      if (updatedOrders.count !== orderIds.length) {
        throw new Error("PAYMENT_PREPARE_CONFLICT");
      }

      return { payment: createdPayment, amount };
    });

    return NextResponse.json({
      tossOrderId: payment.tossOrderId,
      amount,
      orderName,
      clientKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_PAYMENT_AMOUNT") {
      return NextResponse.json({ error: "INVALID_PAYMENT_AMOUNT" }, { status: 400 });
    }
    console.error("TOSS_PAYMENT_PREPARE_FAILED", error);
    return NextResponse.json({ error: "PAYMENT_PREPARE_FAILED" }, { status: 409 });
  }
}
