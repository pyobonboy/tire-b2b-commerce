import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CANCEL_STATUS, ORDER_STATUS } from "@/lib/order-status";
import { prisma } from "@/lib/server/prisma";
import { restoreListingStockForCancelledOrder } from "@/lib/server/orders";
import { getClientIp } from "@/lib/server/requestIp";
import { tossWebhookIpLimiter } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// WHAT THIS ENDPOINT DOES AND WHY IT'S SAFE WITHOUT A SIGNATURE
// ---------------------------------------------------------------------------
// Confirmed directly against Toss's own webhook documentation
// (https://docs.tosspayments.com/guides/webhook) before writing this file:
//   - Toss does NOT sign webhook deliveries. There is no signature header and
//     no HMAC scheme. The docs' only stated security guidance is "use
//     HTTPS". So there is nothing to cryptographically verify here — this is
//     not a gap in this implementation, it is a fact about the product. Do
//     not add a made-up signature check "for defense in depth"; it would
//     verify nothing and would just be misleading to a future reader.
//   - Toss DOES publish a list of the IP addresses it sends webhooks from
//     (https://docs.tosspayments.com/reference/using-api/security):
//       13.124.18.147, 13.124.108.35, 3.36.173.151, 3.38.81.32,
//       115.92.221.121, 115.92.221.122, 115.92.221.123, 115.92.221.125,
//       115.92.221.126, 115.92.221.127
//     This is deliberately NOT used as a hard gate here, for two reasons:
//     (1) that page itself documents the list changing over time (entries
//     added Dec 2024, more scheduled May 2026) — hardcoding it as a
//     rejection rule means a future Toss-side IP addition silently breaks
//     reconciliation until someone updates this file; (2) this app runs
//     behind Render's proxy, and `getClientIp` (requestIp.ts) derives the
//     caller's address from the *last* `x-forwarded-for` hop — whether that
//     is reliably Toss's real origin address on Render specifically has not
//     been verified from within this repo. `TOSS_WEBHOOK_ALLOWED_IPS` (env,
//     comma-separated, optional) lets an operator supply the current list
//     for *monitoring*: a mismatch is logged as a warning, never rejected.
//     See the ip-allowlist check below.
//   - Registration is by URL (per Merchant ID, in the Toss Developer
//     Center), and that URL is arbitrary. That is the one real lever
//     available: `TOSS_WEBHOOK_SECRET` must be embedded in the URL
//     registered with Toss (e.g. ".../api/payments/toss/webhook?secret=<value>"),
//     and is compared with a timing-safe check below. This is a shared
//     bearer secret in the URL, NOT a signature — it will appear in this
//     app's own access logs (and in Toss's dashboard/delivery logs), and
//     rotating it means re-registering a new URL in the Developer Center,
//     not just changing the env var here.
//   - Because that secret is the *only real* gate and isn't cryptographically
//     tied to the request body, THE SECURITY OF THIS ENDPOINT DOES NOT REST
//     ON IT. Even a forged request that somehow guessed/leaked the secret
//     must not be able to change any money-relevant state, because nothing
//     from the webhook body is ever trusted as fact: every field that
//     matters (payment status, amounts, cancellation) is re-read from Toss
//     itself over an authenticated, outbound, server-to-server call using
//     TOSS_SECRET_KEY (GET .../v1/payments/{paymentKey} or
//     .../v1/payments/orders/{orderId} — see below). The webhook body is
//     used only to decide *which* local Payment to re-check, and even that
//     lookup is scoped to a Payment this app already owns (see
//     "no local match" handling below) — a forged body naming an unknown
//     paymentKey/orderId is a harmless no-op, not a lookup that could be
//     tricked into doing something.
//
// LOOKUP ENDPOINT: confirmed via Toss's API reference
// (https://docs.tosspayments.com/reference) as GET
// https://api.tosspayments.com/v1/payments/{paymentKey} (by paymentKey) and
// GET https://api.tosspayments.com/v1/payments/orders/{orderId} (by orderId,
// which for this app is Payment.tossOrderId). This file prefers the
// paymentKey path when a paymentKey is available (either already recorded
// locally, or present in the webhook body) and falls back to the orderId
// path otherwise — which is exactly the case where the buyer closed the tab
// before /api/payments/toss/confirm ever ran, i.e. the scenario this webhook
// exists to catch in the first place.
//
// PAYLOAD SHAPE: Toss's webhook guide states events are delivered as a JSON
// POST body and names event types (PAYMENT_STATUS_CHANGED,
// CANCEL_STATUS_CHANGED, DEPOSIT_CALLBACK, METHOD_UPDATED,
// CUSTOMER_STATUS_CHANGED, payout.changed, seller.changed,
// ORDER_PAYMENT_STATUS_CHANGED), but does not publish the exact field names
// inside the body. Accordingly this file does NOT assert a body schema
// beyond "try to find an eventType, and a paymentKey/orderId under a `data`
// object or at the top level" — every other field (status, amounts, method,
// ...) is read only from the authoritative Toss GET response below, never
// from this body.
//
// RETRY CONTRACT (from the same docs): Toss expects a 200 within 10 seconds;
// otherwise it retries up to 7 times with backoff of 1, 4, 16, 64, 256, 1024,
// 4096 minutes (~3 days 19 hours total) before giving up. This shapes the
// status-code policy below: 200 for anything durably recorded OR
// deliberately ignored (retrying would accomplish nothing either way), and a
// non-2xx only when the failure is plausibly transient (our own DB hiccup,
// or Toss's lookup API itself failing) and a retry could actually help.
//
// TOSS STATUS -> LOCAL STATUS MAPPING: Toss's Payment.status enum (READY,
// IN_PROGRESS, WAITING_FOR_DEPOSIT, DONE, CANCELED, PARTIAL_CANCELED,
// ABORTED, EXPIRED) has more values than this app's Prisma `PaymentStatus`
// (READY, DONE, FAILED, CANCELED — and this task may not change the schema
// to add more). Every Toss status is handled explicitly below rather than
// falling through a catch-all, and none of them are guessed at:
//   - DONE               -> local DONE, approvedAt set (money genuinely
//                            moved; see settlement.ts's reliance on
//                            approvedAt as its "money actually moved" flag).
//   - CANCELED            -> local CANCELED, every still-active order on the
//                            payment cancelled + restocked. Full refund.
//   - PARTIAL_CANCELED    -> local status LEFT AT DONE, deliberately. Only
//                            refundRequiredAt/refundReason/refundAmount are
//                            recorded (owed, pending manual reconciliation).
//                            cancelOrder's own partial-cancel branch now
//                            auto-submits its own per-order cancelAmount to
//                            Toss (see settleOrderRefundViaToss in
//                            src/lib/server/orders.ts) instead of always
//                            deferring to an admin — but a PARTIAL_CANCELED
//                            event arriving *here* means Toss recorded a
//                            partial cancellation this app cannot attribute
//                            to a specific order (e.g. done directly in the
//                            Toss console), and this codebase still has no
//                            per-order tax breakdown to safely auto-match an
//                            unattributed amount to one. Mapping this to local
//                            CANCELED instead would be a real bug:
//                            settlement.ts's getDeposits reads
//                            `status === "CANCELED" && refundRequiredAt ===
//                            null` as "환불완료" (fully refunded) on a
//                            buyer-facing money screen, so a partially
//                            cancelled payment must never end up in that
//                            state — it would tell a buyer their whole
//                            payment came back when only part of it did.
//   - ABORTED / EXPIRED   -> if still local READY, marked local FAILED (the
//                            payment attempt never succeeded, matches
//                            markPaymentFailed's outcome in confirm/
//                            route.ts). If local is already DONE, this is a
//                            contradiction that must never automatically
//                            roll back an approval — logged for a human to
//                            check against the Toss console instead.
//   - IN_PROGRESS /
//     WAITING_FOR_DEPOSIT -> still in flight on Toss's side (this app is
//                            card-only, so WAITING_FOR_DEPOSIT — a virtual
//                            account concept — shouldn't normally occur, but
//                            is handled defensively anyway). Nothing
//                            conclusive yet: no local change, acknowledged
//                            with 200 so Toss doesn't keep retrying.
// Reconciliation prefers Toss's own authoritative accounting fields
// (totalAmount, which never changes once approved, and balanceAmount, the
// remaining cancellable balance) over recomputing "how much was cancelled"
// by re-summing local order rows, which can drift from what Toss actually
// processed.
// ---------------------------------------------------------------------------

const RELEVANT_EVENT_TYPES = new Set(["PAYMENT_STATUS_CHANGED", "CANCEL_STATUS_CHANGED"]);

// Deliberately loose: only the two identifiers this route needs are typed,
// and everything else is passed through untouched rather than asserted, per
// the "payload shape not published" note above.
const tossWebhookBodySchema = z
  .object({
    eventType: z.string().trim().max(100).optional(),
    data: z
      .object({
        paymentKey: z.string().trim().min(1).max(200).optional(),
        orderId: z.string().trim().min(1).max(200).optional(),
      })
      .passthrough()
      .optional(),
    paymentKey: z.string().trim().min(1).max(200).optional(),
    orderId: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();

// The authoritative payment resource, as returned by both lookup endpoints
// above (the same "Payment" object Toss's confirm/cancel APIs also return —
// see TossConfirmResponse in confirm/route.ts for the same resource's
// `method` field used there). Only the fields this route actually acts on
// are declared; anything else in the response is ignored.
interface TossPaymentLookupResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  approvedAt?: string | null;
  method?: string | null;
  totalAmount?: number;
  balanceAmount?: number;
}

const cancelledStatusValues = Object.values(CANCEL_STATUS);

/**
 * Compares the `secret` query parameter against `TOSS_WEBHOOK_SECRET` with a
 * timing-safe comparison. See the file header — this is a shared bearer
 * secret embedded in the registered webhook URL, not a signature.
 */
function verifyWebhookSecret(request: Request, expectedSecret: string): boolean {
  const provided = new URL(request.url).searchParams.get("secret") ?? "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expectedSecret);
  // timingSafeEqual throws on mismatched lengths; comparing lengths first is
  // not itself constant-time, but leaking only the *length* of a value that
  // must match exactly (not partially) is an accepted, common trade-off here
  // (mirrors how token comparisons are usually written).
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: Request) {
  const webhookSecret = process.env.TOSS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Safe-by-default: an unconfigured secret must never be treated as "no
    // auth required". Do nothing.
    return NextResponse.json({ error: "TOSS_WEBHOOK_SECRET_MISSING" }, { status: 503 });
  }

  // Flood guard before anything else — see rateLimit.ts for why this exists
  // even though it can't distinguish genuine Toss traffic from forged
  // traffic by shape. There's no other axis to key this on (unlike login/
  // signup, which also have an identifier), so when getClientIp can't
  // determine a trustworthy IP (see requestIp.ts; effectively local-dev-only
  // behind Render's proxy in production) skip the flood limiter entirely
  // rather than interpolate null into a shared bucket key.
  const ip = getClientIp(request.headers);
  if (ip !== null) {
    if (tossWebhookIpLimiter.isBlocked(ip)) {
      return NextResponse.json({ error: "TOO_MANY_REQUESTS" }, { status: 429 });
    }
    tossWebhookIpLimiter.record(ip);
  }

  // Monitoring only, never a gate — see the file header for why a mismatch
  // here must not reject the request. `TOSS_WEBHOOK_ALLOWED_IPS` is an
  // optional, comma-separated env var; when unset this check is a no-op. A
  // null ip (see above) can never be "in" the allowlist, so it's treated the
  // same as any other mismatch — logged, not gated.
  const allowedIpsEnv = process.env.TOSS_WEBHOOK_ALLOWED_IPS?.trim();
  if (allowedIpsEnv) {
    const allowedIps = new Set(
      allowedIpsEnv
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    if (ip === null || !allowedIps.has(ip)) {
      console.warn("TOSS_WEBHOOK_IP_NOT_IN_ALLOWLIST", { ip });
    }
  }

  if (!verifyWebhookSecret(request, webhookSecret)) {
    console.error("TOSS_WEBHOOK_SECRET_MISMATCH", { ip });
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const tossSecretKey = process.env.TOSS_SECRET_KEY;
  if (!tossSecretKey) {
    return NextResponse.json({ error: "TOSS_SECRET_KEY_MISSING" }, { status: 503 });
  }

  const parsedBody = tossWebhookBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    // Malformed body: retrying the exact same body will never parse
    // differently, so acknowledge rather than let Toss burn its retry budget.
    console.error("TOSS_WEBHOOK_BODY_UNPARSEABLE");
    return NextResponse.json({ received: true, ignored: true });
  }

  const { eventType } = parsedBody.data;
  if (eventType && !RELEVANT_EVENT_TYPES.has(eventType)) {
    // Recognised-but-irrelevant (this app is card-only, so e.g.
    // DEPOSIT_CALLBACK for virtual accounts never applies) or genuinely
    // unrecognised — either way, acknowledge so Toss doesn't keep retrying
    // an event type this app will never act on.
    return NextResponse.json({ received: true, ignored: true });
  }

  const paymentKeyFromBody = parsedBody.data.data?.paymentKey ?? parsedBody.data.paymentKey;
  const orderIdFromBody = parsedBody.data.data?.orderId ?? parsedBody.data.orderId;
  if (!paymentKeyFromBody && !orderIdFromBody) {
    console.error("TOSS_WEBHOOK_NO_IDENTIFIER", { eventType });
    return NextResponse.json({ received: true, ignored: true });
  }

  // Scope the lookup to a Payment this app actually owns. tossOrderId is set
  // at /api/payments/toss/prepare time and is always present, so prefer it;
  // paymentKey is only ever set once a payment has been confirmed at least
  // once, so fall back to it only when no orderId was supplied.
  const localPayment = orderIdFromBody
    ? await prisma.payment.findFirst({ where: { tossOrderId: orderIdFromBody } })
    : await prisma.payment.findFirst({ where: { paymentKey: paymentKeyFromBody } });

  if (!localPayment) {
    // A forged or foreign identifier naming a payment this app has never
    // heard of. Nothing to reconcile, and nothing was trusted from the body
    // to reach this point besides "which row to look at" — a no-op 200.
    console.error("TOSS_WEBHOOK_NO_LOCAL_PAYMENT_MATCH", { eventType, orderIdFromBody, paymentKeyFromBody });
    return NextResponse.json({ received: true, ignored: true });
  }

  // Prefer the paymentKey path (paymentKey already on file, or supplied by
  // the webhook body) — it is the more specific of the two confirmed lookup
  // paths. Fall back to the orderId path (always resolvable, since
  // localPayment.tossOrderId is guaranteed set) for a payment that was never
  // confirmed locally at all, i.e. exactly the "buyer closed the tab before
  // confirm ran" case this webhook exists for.
  const paymentKeyForLookup = localPayment.paymentKey ?? paymentKeyFromBody ?? null;
  const lookupUrl = paymentKeyForLookup
    ? `https://api.tosspayments.com/v1/payments/${paymentKeyForLookup}`
    : `https://api.tosspayments.com/v1/payments/orders/${localPayment.tossOrderId}`;

  const authorization = Buffer.from(`${tossSecretKey}:`).toString("base64");
  let tossResponse: Response;
  try {
    tossResponse = await fetch(lookupUrl, {
      method: "GET",
      headers: { Authorization: `Basic ${authorization}` },
    });
  } catch (error) {
    // Transient (network) failure calling out to Toss — a retry could
    // genuinely help, so use Toss's own backoff schedule for that.
    console.error("TOSS_WEBHOOK_LOOKUP_REQUEST_FAILED", { paymentId: localPayment.id, error });
    return NextResponse.json({ error: "TOSS_LOOKUP_FAILED" }, { status: 502 });
  }

  if (!tossResponse.ok) {
    if (tossResponse.status === 404) {
      // Toss has no record of this payment/order at all. Retrying the same
      // lookup will never find it, so acknowledge instead of retrying
      // forever.
      console.error("TOSS_WEBHOOK_LOOKUP_404", { paymentId: localPayment.id, lookupUrl });
      return NextResponse.json({ received: true, ignored: true });
    }
    console.error("TOSS_WEBHOOK_LOOKUP_NOT_OK", { paymentId: localPayment.id, status: tossResponse.status });
    return NextResponse.json({ error: "TOSS_LOOKUP_FAILED" }, { status: 502 });
  }

  const tossPayment = (await tossResponse.json().catch(() => null)) as TossPaymentLookupResponse | null;
  if (!tossPayment || typeof tossPayment.status !== "string") {
    console.error("TOSS_WEBHOOK_LOOKUP_MALFORMED", { paymentId: localPayment.id });
    return NextResponse.json({ error: "TOSS_LOOKUP_MALFORMED" }, { status: 502 });
  }

  try {
    if (tossPayment.status === "DONE") {
      // Sanity check against what this app itself decided to charge
      // (Payment.amount, fixed at /api/payments/toss/prepare time from the
      // orders' own unitPrice/quantity/extraShipping). A mismatch here means
      // something is wrong enough that auto-approving would be dangerous —
      // log for a human to compare against the Toss console rather than
      // silently recording an unexpected amount as "money moved".
      if (typeof tossPayment.totalAmount === "number" && tossPayment.totalAmount !== localPayment.amount) {
        console.error("TOSS_WEBHOOK_AMOUNT_MISMATCH", {
          paymentId: localPayment.id,
          expected: localPayment.amount,
          actual: tossPayment.totalAmount,
        });
        return NextResponse.json({ received: true, ignored: true });
      }

      await prisma.$transaction(async (tx) => {
        // Guarded on approvedAt (not status): approvedAt is settlement.ts's
        // "money actually moved" discriminator and must be set exactly once,
        // the first time Toss confirms an approval — repeat deliveries of
        // the same DONE event must not touch it again. This is deliberately
        // NOT guarded on `status: "READY"` the way confirm/route.ts's own
        // write is: this webhook is also the intended recovery path for the
        // ORDER_STATUS_SYNC_FAILED case documented in confirm/route.ts
        // (Payment already correctly recorded as DONE, but some of its
        // orders never got flipped to 입금완료) — approvedAt already being
        // set there must not block re-attempting the order-sync below.
        await tx.payment.updateMany({
          where: { id: localPayment.id, approvedAt: null },
          data: {
            status: "DONE",
            paymentKey: tossPayment.paymentKey,
            method: tossPayment.method ?? null,
            approvedAt: tossPayment.approvedAt ? new Date(tossPayment.approvedAt) : new Date(),
            failReason: null,
          },
        });

        // Same guarded transition confirm/route.ts uses: only orders still
        // awaiting payment flip to 입금완료, so an order already cancelled
        // elsewhere is never resurrected and order.status never moves
        // backwards. Idempotent by construction — a repeat delivery matches
        // 0 rows the second time.
        await tx.order.updateMany({
          where: { paymentId: localPayment.id, status: ORDER_STATUS.PAYMENT_PENDING },
          data: { status: ORDER_STATUS.PAYMENT_COMPLETED },
        });

        // Mirrors confirm/route.ts's own stale-orders bookkeeping: an order
        // on this payment that isn't 입금완료 after the sync above (because
        // it was cancelled/expired elsewhere while this reconciliation was
        // in flight) represents money Toss says was charged for something
        // this app no longer considers sold — flag it for a refund the same
        // way, rather than silently losing track of it.
        const currentOrders = await tx.order.findMany({
          where: { paymentId: localPayment.id },
          select: { id: true, status: true, unitPrice: true, quantity: true, extraShipping: true, shippingFee: true },
        });
        const staleOrders = currentOrders.filter((order) => order.status !== ORDER_STATUS.PAYMENT_COMPLETED);
        if (staleOrders.length > 0) {
          // shippingFee folds in here the same way extraShipping already did
          // — see the comment in toss/prepare/route.ts's own amount calc.
          const staleAmount = staleOrders.reduce(
            (total, order) => total + order.unitPrice * order.quantity + order.extraShipping + order.shippingFee,
            0,
          );
          console.error("TOSS_WEBHOOK_STALE_ORDERS", {
            paymentId: localPayment.id,
            staleOrderIds: staleOrders.map((order) => order.id),
            staleAmount,
          });
          await tx.payment.update({
            where: { id: localPayment.id },
            data: {
              refundRequiredAt: new Date(),
              refundReason: "ORDER_CANCELED_BEFORE_PAYMENT_CONFIRMED",
              refundAmount: { increment: staleAmount },
            },
          });
        }
      });

      return NextResponse.json({ received: true });
    }

    if (tossPayment.status === "CANCELED" || tossPayment.status === "PARTIAL_CANCELED") {
      const isFullCancel = tossPayment.status === "CANCELED";

      await prisma.$transaction(async (tx) => {
        const current = await tx.payment.findUnique({ where: { id: localPayment.id } });
        if (!current) return;

        if (current.status !== "DONE") {
          // Never approved locally (or already reconciled to CANCELED) — no
          // charge to unwind, and no order was ever marked paid off of this
          // payment. Record Toss's view for visibility only; cleaning up any
          // order still sitting on it is expireStaleUnpaidOrders'/
          // toss/prepare's job, not this webhook's.
          await tx.payment.updateMany({
            where: { id: localPayment.id, status: { notIn: ["DONE", "CANCELED"] } },
            data: { status: "CANCELED", failReason: `TOSS_WEBHOOK_RECONCILE_${tossPayment.status}` },
          });
          return;
        }

        // Authoritative "how much of this payment is no longer chargeable",
        // per Toss's own accounting: totalAmount never changes once
        // approved, and balanceAmount is the remaining cancellable balance
        // after every cancellation to date. This is preferred over
        // recomputing "how much did I just cancel" by re-summing local
        // order rows below, which can drift from what Toss actually
        // processed (e.g. if some of this payment's orders were already
        // individually cancelled through cancelOrder before this webhook
        // ever ran).
        const cancelledTotalPerToss =
          (tossPayment.totalAmount ?? current.amount) - (tossPayment.balanceAmount ?? 0);
        const newlyCancelledAmount = Math.max(0, cancelledTotalPerToss - current.refundAmount);

        if (!isFullCancel) {
          // PARTIAL_CANCELED: deliberately do NOT touch Payment.status here
          // — see the TOSS STATUS -> LOCAL STATUS MAPPING comment at the top
          // of this file for why flipping status to CANCELED on a partial
          // cancellation would misreport a full refund on settlement.ts's
          // buyer-facing money screen. Unlike cancelOrder's own partial-
          // cancel branch (which now knows exactly which order and exactly
          // how much — see settleOrderRefundViaToss), a partial cancellation
          // reported here arrived without this app ever choosing it, so
          // there is no specific order to attribute it to and no per-order
          // tax breakdown to safely guess one — record it as owed for
          // manual/admin reconciliation instead of guessing at which order
          // to cancel.
          if (newlyCancelledAmount > 0) {
            await tx.payment.update({
              where: { id: localPayment.id },
              data: {
                refundRequiredAt: new Date(),
                refundReason: "PARTIAL_CANCEL_DETECTED_VIA_TOSS_WEBHOOK_NEEDS_MANUAL_ORDER_MATCH",
                refundAmount: { increment: newlyCancelledAmount },
              },
            });
          }
          return;
        }

        // Full cancellation confirmed by Toss (e.g. performed directly in
        // the Toss console) but this payment is still DONE locally — cancel
        // every order still active on it, restoring stock exactly the way
        // cancelOrder does (same shared helper). The order loop below only
        // ever flips order.status/restocks; the refund bookkeeping amount
        // itself comes from newlyCancelledAmount (Toss's own accounting),
        // not from re-summing these orders' price fields.
        const activeOrders = await tx.order.findMany({
          where: { paymentId: localPayment.id, status: { notIn: cancelledStatusValues } },
          include: { listing: true },
        });

        for (const order of activeOrders) {
          // Guarded updateMany: if this order moved off its snapshotted
          // status between the findMany above and here (a concurrent
          // seller/admin/buyer action), skip it rather than clobber
          // whatever that other write just did.
          const marked = await tx.order.updateMany({
            where: { id: order.id, status: order.status },
            data: {
              status: CANCEL_STATUS.PAYMENT_AFTER,
              cancelReason: "Toss 결제 취소가 확인되어 자동 반영되었습니다.",
            },
          });
          if (marked.count !== 1) continue;

          await restoreListingStockForCancelledOrder(tx, {
            listingId: order.listingId,
            quantity: order.quantity,
            listingStatus: order.listing.status,
          });
        }

        // Guarded on `status: { not: "CANCELED" }` so a repeat delivery of
        // the same fully-cancelled event (nothing left to newly account for)
        // still flips status/clears refundRequiredAt exactly once and never
        // double-increments refundAmount on later replays.
        await tx.payment.updateMany({
          where: { id: localPayment.id, status: { not: "CANCELED" } },
          data: {
            status: "CANCELED",
            refundRequiredAt: null,
            refundReason: "FULLY_CANCELED_VIA_TOSS_WEBHOOK_RECONCILE",
            ...(newlyCancelledAmount > 0 ? { refundAmount: { increment: newlyCancelledAmount } } : {}),
          },
        });
      });

      return NextResponse.json({ received: true });
    }

    // Remaining Toss statuses — see the TOSS STATUS -> LOCAL STATUS MAPPING
    // comment at the top of this file.
    if (tossPayment.status === "ABORTED" || tossPayment.status === "EXPIRED") {
      // Terminal failure before ever being approved.
      if (localPayment.status === "READY") {
        await prisma.payment.updateMany({
          where: { id: localPayment.id, status: "READY" },
          data: { status: "FAILED", failReason: `TOSS_WEBHOOK_RECONCILE_${tossPayment.status}` },
        });
      } else if (localPayment.status === "DONE") {
        // Contradicts what confirm/route.ts (or this webhook's own DONE
        // branch above) already recorded as an approved charge. Never
        // resurrect or roll back approvedAt automatically here — this needs
        // a human to compare against the Toss console (see README's 운영
        // 가이드).
        console.error("TOSS_WEBHOOK_STATUS_CONTRADICTS_LOCAL_DONE", {
          paymentId: localPayment.id,
          tossStatus: tossPayment.status,
        });
      }
      return NextResponse.json({ received: true });
    }

    // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT (this app is card-only, so
    // the virtual-account-only WAITING_FOR_DEPOSIT shouldn't normally occur,
    // but is handled defensively), or any other status Toss might introduce
    // later — nothing conclusive yet. No local change; acknowledge so Toss
    // doesn't keep retrying an event with nothing new to report.
    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    // Unexpected failure writing the reconciliation (DB hiccup, etc.) — a
    // retry could genuinely help, so let Toss's backoff schedule handle it.
    console.error("TOSS_WEBHOOK_RECONCILE_FAILED", { paymentId: localPayment.id, error });
    return NextResponse.json({ error: "TOSS_WEBHOOK_RECONCILE_FAILED" }, { status: 500 });
  }
}
