import { NextResponse } from "next/server";
import { z } from "zod";
import { ORDER_STATUS } from "@/lib/order-status";
import { prisma } from "@/lib/server/prisma";
import { requireRole } from "@/lib/server/guard";

export const runtime = "nodejs";

const confirmPaymentSchema = z.object({
  paymentKey: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(200),
  amount: z.coerce.number().int().positive(),
});

type TossConfirmResponse = {
  code?: string;
  message?: string;
  method?: string;
};

async function markPaymentFailed(paymentId: string, reason: string) {
  await prisma.payment.updateMany({
    where: { id: paymentId, status: "READY" },
    data: {
      status: "FAILED",
      failReason: reason.slice(0, 1_000),
    },
  });
}

async function cancelTossPayment(paymentKey: string, authorization: string, reason: string) {
  try {
    const response = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cancelReason: reason }),
    });
    return response.ok;
  } catch (error) {
    console.error("TOSS_PAYMENT_CONFIRM_AUTO_CANCEL_REQUEST_FAILED", error);
    return false;
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["BUYER"]);
  if (auth.response) return auth.response;

  const parsed = confirmPaymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { paymentKey, orderId: tossOrderId, amount } = parsed.data;
  const payment = await prisma.payment.findFirst({
    where: {
      tossOrderId,
      buyerId: auth.session.user.id,
    },
    include: { orders: true },
  });

  if (!payment) {
    return NextResponse.json({ error: "PAYMENT_NOT_FOUND" }, { status: 404 });
  }

  // 사람이 읽는 주문번호(예: 20260825-0003). 결제완료 화면이 내부
  // tossOrderId(order_<uuid>) 대신 이 값을 보여줄 수 있도록 모든 성공 응답에
  // 함께 내려준다. orderNo 는 주문 생성 시 확정돼 이후 바뀌지 않으므로, 이
  // 스냅샷(include: orders)으로 아래 모든 분기에서 안전하게 쓸 수 있다. 컬럼
  // 이전 주문은 null 이라 화면에서 tossOrderId 로 폴백한다.
  const orderNos = payment.orders
    .map((order) => order.orderNo)
    .filter((orderNo): orderNo is string => orderNo !== null);

  // Idempotent replay: a page refresh or a double-fired confirm request for a
  // payment we already approved must not call Toss again. Return the same
  // success shape instead of failing the second call.
  if (payment.status === "DONE") {
    if (payment.paymentKey !== paymentKey) {
      return NextResponse.json({ error: "PAYMENT_ALREADY_CONFIRMED_WITH_DIFFERENT_KEY" }, { status: 409 });
    }
    const completedOrderCount = await prisma.order.count({
      where: { paymentId: payment.id, status: ORDER_STATUS.PAYMENT_COMPLETED },
    });
    return NextResponse.json({
      payment: {
        tossOrderId: payment.tossOrderId,
        status: payment.status,
        method: payment.method,
        approvedAt: payment.approvedAt?.toISOString() ?? null,
        orderCount: completedOrderCount,
        orderNos,
      },
    });
  }
  if (payment.status !== "READY") {
    return NextResponse.json({ error: "PAYMENT_NOT_READY" }, { status: 409 });
  }
  if (payment.amount !== amount) {
    return NextResponse.json({ error: "PAYMENT_AMOUNT_MISMATCH" }, { status: 400 });
  }
  // A payment can end up with no orders attached if every order that was
  // bound to it got re-prepared onto a different payment before this one was
  // approved. Reject before charging the card for nothing.
  if (payment.orders.length === 0) {
    return NextResponse.json({ error: "PAYMENT_HAS_NO_ORDERS" }, { status: 409 });
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "TOSS_SECRET_KEY_MISSING" }, { status: 503 });
  }

  const authorization = Buffer.from(`${secretKey}:`).toString("base64");
  let tossResponse: Response;
  let tossBody: TossConfirmResponse;

  try {
    tossResponse = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId: tossOrderId, amount }),
    });
    tossBody = (await tossResponse.json().catch(() => ({}))) as TossConfirmResponse;
  } catch (error) {
    console.error("TOSS_PAYMENT_CONFIRM_REQUEST_FAILED", error);
    await markPaymentFailed(payment.id, "TOSS_CONFIRM_REQUEST_FAILED");
    return NextResponse.json({ error: "TOSS_PAYMENT_CONFIRM_FAILED" }, { status: 502 });
  }

  if (!tossResponse.ok) {
    const failReason = tossBody.message ?? tossBody.code ?? "TOSS_PAYMENT_CONFIRM_FAILED";
    await markPaymentFailed(payment.id, failReason);
    return NextResponse.json(
      { error: "TOSS_PAYMENT_CONFIRM_FAILED", code: tossBody.code },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.updateMany({
        where: { id: payment.id, status: "READY" },
        data: {
          status: "DONE",
          paymentKey,
          method: tossBody.method ?? null,
          approvedAt: new Date(),
          failReason: null,
        },
      });

      if (updatedPayment.count !== 1) {
        throw new Error("PAYMENT_CONFIRM_CONFLICT");
      }

      // Only orders still awaiting payment may flip to 입금완료. An order
      // under this payment can have moved on already (e.g. it was cancelled
      // while a second browser tab kept this payment open), and re-marking it
      // paid here would resurrect a cancelled order and oversell its stock.
      const updatedOrders = await tx.order.updateMany({
        where: { paymentId: payment.id, status: ORDER_STATUS.PAYMENT_PENDING },
        data: { status: ORDER_STATUS.PAYMENT_COMPLETED },
      });

      // Recompute which orders are stale from a fresh read taken *inside*
      // this transaction, not from the `payment.orders` snapshot fetched
      // above (before the Toss approval round trip). That round trip can
      // take anywhere from hundreds of ms to a few seconds, which is enough
      // time for an order to be cancelled in another request; deciding
      // refunds off the pre-approval snapshot would silently miss exactly
      // that order's amount.
      const currentOrders = await tx.order.findMany({
        where: { paymentId: payment.id },
        select: { id: true, status: true, unitPrice: true, quantity: true, extraShipping: true, shippingFee: true },
      });
      const staleOrders = currentOrders.filter(
        (order) => order.status !== ORDER_STATUS.PAYMENT_COMPLETED,
      );
      if (staleOrders.length > 0) {
        // shippingFee folds in here the same way extraShipping already did —
        // see the comment in toss/prepare/route.ts's own amount calc.
        const staleAmount = staleOrders.reduce(
          (total, order) => total + order.unitPrice * order.quantity + order.extraShipping + order.shippingFee,
          0,
        );
        console.error("TOSS_PAYMENT_CONFIRM_STALE_ORDERS", {
          paymentId: payment.id,
          tossOrderId: payment.tossOrderId,
          staleOrderIds: staleOrders.map((order) => order.id),
          staleAmount,
        });
        // This is the same "money owed on a still-active payment" shape that
        // src/lib/server/orders.ts's cancelOrder now auto-submits to Toss for
        // (see settleOrderRefundViaToss there) — but deliberately NOT wired
        // to that same auto-submit mechanism here. Two reasons: (1) this
        // write happens inside the transaction that also just marked the
        // Payment DONE, and an external Toss call must never run inside a
        // Prisma transaction (see the long comment in cancelOrder for why);
        // adding a post-commit Toss call here would mean restructuring this
        // route's already-intricate save-failure/compensation logic below,
        // which is exactly the kind of change that risks destabilizing a
        // money-critical recovery path it wasn't scoped to touch. (2)
        // staleAmount can span several stale orders at once, so refunding it
        // automatically here would need its own careful reasoning about
        // idempotency/over-refund guards independent of cancelOrder's
        // per-order ones. Recording it durably here — exactly as before —
        // still makes the admin "환불 필요" badge and manual Toss-console
        // fallback (README's 운영 가이드) work; only the automatic-submission
        // half is out of scope for this change.
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundRequiredAt: new Date(),
            refundReason: "ORDER_CANCELED_BEFORE_PAYMENT_CONFIRMED",
            refundAmount: { increment: staleAmount },
          },
        });
      }

      const completedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return { completedPayment, updatedOrderCount: updatedOrders.count };
    });

    return NextResponse.json({
      payment: {
        tossOrderId: result.completedPayment.tossOrderId,
        status: result.completedPayment.status,
        method: result.completedPayment.method,
        approvedAt: result.completedPayment.approvedAt?.toISOString() ?? null,
        orderCount: result.updatedOrderCount,
        orderNos,
      },
    });
  } catch (error) {
    console.error("TOSS_PAYMENT_CONFIRM_SAVE_FAILED", error);

    // Toss already charged the card at this point. Prefer recording that fact
    // over anything else: if we can persist paymentKey/approvedAt, the charge
    // is legitimate and only the per-order status sync needs a manual/async
    // follow-up, so keep the money and flag it via failReason for reconciliation.
    //
    // The compensating write below can fail in two different ways that must
    // NOT be treated the same:
    //  - it throws (a real DB error) -> we genuinely couldn't record anything.
    //  - it runs but matches 0 rows (the `status: "READY"` filter misses)
    //    -> some other request already moved this payment off READY. If that
    //    other request is the reason (a concurrent confirm that finished
    //    first and left the payment DONE with its orders already marked
    //    입금완료), then reaching the auto-cancel fallback below would refund
    //    a legitimately completed payment while its orders stay paid.
    let writeThrew = false;
    let recordedRowCount = 0;
    try {
      const recordedUpdate = await prisma.payment.updateMany({
        where: { id: payment.id, status: "READY" },
        data: {
          status: "DONE",
          paymentKey,
          method: tossBody.method ?? null,
          approvedAt: new Date(),
          failReason:
            `ORDER_STATUS_SYNC_FAILED: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              1_000,
            ),
        },
      });
      recordedRowCount = recordedUpdate.count;
    } catch (recordError) {
      writeThrew = true;
      console.error("TOSS_PAYMENT_CONFIRM_COMPENSATION_RECORD_FAILED", {
        paymentId: payment.id,
        tossOrderId: payment.tossOrderId,
        paymentKey,
        amount,
        recordError,
      });
    }

    if (recordedRowCount === 1) {
      return NextResponse.json({ error: "PAYMENT_CONFIRM_PENDING_RECONCILIATION" }, { status: 202 });
    }

    if (!writeThrew) {
      // The write ran cleanly but matched nothing: re-check what the payment
      // actually is now before deciding whether cancelling it is safe.
      const currentPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
      if (currentPayment?.status === "DONE") {
        // A concurrent confirm request already approved and persisted this
        // payment. Treat this the same as the idempotent-replay branch above
        // this transaction — report success, and do not call Toss's cancel
        // API on a charge that was legitimately completed.
        const completedOrderCount = await prisma.order.count({
          where: { paymentId: currentPayment.id, status: ORDER_STATUS.PAYMENT_COMPLETED },
        });
        return NextResponse.json({
          payment: {
            tossOrderId: currentPayment.tossOrderId,
            status: currentPayment.status,
            method: currentPayment.method,
            approvedAt: currentPayment.approvedAt?.toISOString() ?? null,
            orderCount: completedOrderCount,
            orderNos,
          },
        });
      }
      // Any other status here (e.g. CANCELED via toss/prepare's
      // supersede-on-re-prepare cleanup) means nobody else recorded this
      // approval as legitimate, so reversing the charge below is correct.
    }

    // We could not treat this approval as a legitimately recorded payment.
    // As a last resort, try to reverse the charge so it doesn't sit
    // uncredited and unrecorded; only then is it safe to tell the buyer to
    // retry.
    const tossCancelSucceeded = await cancelTossPayment(
      paymentKey,
      authorization,
      "INTERNAL_ERROR_AUTO_CANCEL",
    );
    if (tossCancelSucceeded) {
      await prisma.payment
        .updateMany({
          where: { id: payment.id, status: { not: "DONE" } },
          data: { status: "CANCELED", failReason: "DB_SAVE_FAILED_AUTO_CANCELED" },
        })
        .catch((cancelRecordError) => {
          console.error("TOSS_PAYMENT_CONFIRM_CANCEL_RECORD_FAILED", cancelRecordError);
        });
      return NextResponse.json({ error: "TOSS_PAYMENT_CONFIRM_FAILED" }, { status: 502 });
    }

    console.error("TOSS_PAYMENT_CONFIRM_UNRECOVERABLE", {
      paymentId: payment.id,
      tossOrderId: payment.tossOrderId,
      paymentKey,
      amount,
    });
    return NextResponse.json({ error: "PAYMENT_CONFIRM_PENDING_RECONCILIATION" }, { status: 202 });
  }
}
