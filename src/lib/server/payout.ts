// ---------------------------------------------------------------------------
// 판매자 정산 (payout) — NOT the buyer-facing 입출금/세금계산서 screen in
// settlement.ts. That module answers "what did a BUYER pay and get refunded";
// this one answers "how much does the platform owe a SELLER, and has it paid
// them yet". Same domain word in Korean (정산), different concept, so this
// file is named payout.ts rather than settlement.ts on purpose — see AGENTS.md.
//
// WHAT COUNTS AS SETTLEABLE
// An order is only settleable once the sale is both real and final:
//   1. `order.status` is not one of nonSettleableStatusValues — CANCEL_STATUS's
//      values MINUS EXCHANGE_COMPLETED. An exchange is a completed sale, not a
//      cancelled one: the buyer keeps the goods and the payment stays DONE, so
//      unlike every other CANCEL_STATUS value there is no refund to net
//      against here. See nonSettleableStatusValues below for the full
//      reasoning and completeReturnRequest (returns.ts) for the concrete
//      evidence this is built on (only a RETURN ever records a refund there).
//   2. `order.paymentId` points at a Payment that was genuinely approved —
//      `Payment.approvedAt` is the discriminator, not `status`. This mirrors
//      getDeposits' reasoning in settlement.ts, and for the same reason:
//      `status` alone conflates three different histories (see that file's
//      long comment) — a payment can read CANCELED either because it was
//      reversed before ever being charged (DB_SAVE_FAILED_AUTO_CANCELED,
//      approvedAt never set) or because Toss genuinely charged it and it was
//      later fully refunded (approvedAt stays set — nothing ever clears it).
//      Only `approvedAt IS NOT NULL` answers "did money actually move",
//      which is the only question that matters for paying a seller.
//
// PARTIAL REFUNDS. cancelOrder (orders.ts) can refund one order out of
// several on the same Payment while the payment itself stays DONE (not every
// order on it is cancelled). Filtering on `order.status` (not `payment.status`)
// handles this correctly on its own: the cancelled order is excluded by its
// own status regardless of what its payment looks like, and the *other*,
// still-live orders on that same payment stay eligible — exactly what should
// happen, since their money was never returned. The one case worth checking
// against cancelOrder directly: can a payment ever flip to CANCELED (fully
// refunded) while one of its orders is still NOT cancelled? No — cancelOrder
// only computes `isFullRefund = remainingActiveOrders === 0` (this order plus
// every other non-cancelled order on the payment), and settleOrderRefundViaToss
// only sets Payment.status to CANCELED when isFullRefund is true. So by
// construction, a payment can only ever reach CANCELED once *every* order
// tied to it already carries a cancelled status — meaning the order-status
// filter alone already excludes every order on a fully-refunded payment, with
// no need to separately branch on payment.status here at all.
//
// SHIPPING AND COMMISSION. Order.shippingFee (base courier fee, snapshotted
// from Seller.shippingFee) and Order.extraShipping (도서산간 등 추가분, see
// its own schema comment) are both pass-through delivery cost, not goods
// revenue the platform intermediated — the seller owes the courier the full
// amount regardless of what the platform's cut is. So both are included in
// grossAmount/netAmount (the seller is still owed that money) but EXCLUDED
// from the commissionable base: commission is charged on
// `unitPrice * quantity` only. Taking a commission out of pass-through
// shipping would either shortchange the seller's actual courier cost or
// require the platform to eat part of a fee it never intended to monetize.
//
// ROUNDING. Commission is rounded once, on the summed goods amount for the
// whole settlement batch (`Math.round(goodsAmount * rate / 100)`), not once
// per order and then summed — summing N independently-rounded commissions
// can drift a few won away from rounding the batch total once. summarizeOrders'
// own netAmount (orders only, no adjustment) is never computed independently;
// it is always `grossAmount - commissionAmount` by subtraction, so the two can
// never disagree with each other by construction. Every netAmount actually
// exposed by this module (the live preview aggregates AND a confirmed
// Settlement row) goes one step further and also adds adjustmentAmount — the
// seller's clawback backlog, see the SETTLEMENT CLAWBACK section below — on
// top of that subtraction, which can legitimately push netAmount negative.
// That is allowed on purpose (see confirmPayout's comment on this): a
// negative netAmount is this app's only ledger entry for "this seller now
// owes the platform", so it is carried through and shown as-is rather than
// clamped to 0.
//
// DOUBLE-CLAIM GUARD. confirmPayout reads candidate orders, computes the
// snapshot from exactly that set, then claims them with a conditional
// `updateMany` guarded on `settlementId: null` (re-checked at claim time, not
// trusted from the earlier read) AND `status` still settleable (in case one
// of them was cancelled in the instant between the read and the claim). If
// the claimed count doesn't match the candidate count — another confirm beat
// this one to some of the same orders, or one was cancelled mid-flight — the
// whole transaction is aborted rather than left with a Settlement whose
// snapshot doesn't exactly match the orders pointing at it. See confirmPayout.
import { Prisma, SettlementStatus, type Settlement } from "@prisma/client";
import { z } from "zod";
import { CANCEL_STATUS } from "@/lib/order-status";
import type {
  AdminPayoutSettlementView,
  AdminUnsettledSellerRow,
  PayoutAggregate,
  PayoutSettlementView,
} from "@/lib/payout-types";
import { currentKstMonthPeriod, parseKstDateOnly } from "./kst";
import { prisma } from "./prisma";

const cancelledStatusValues = Object.values(CANCEL_STATUS);

// Settlement-only exclusion set: every CANCEL_STATUS value EXCEPT
// EXCHANGE_COMPLETED. cancelledStatusValues above stays the full set — other
// screens (order-status.ts's own callers, cancelOrder's shipping-fee heir
// query) need "has this order's progress ended" and an exchange's progress
// genuinely has ended, so that broader meaning is correct for them. Payout
// asks a narrower question — "did the seller stop being owed for this sale" —
// and an exchange never un-owes the seller: the buyer keeps the goods and the
// payment stays DONE, so completeReturnRequest (returns.ts) only ever records
// a refund for a RETURN, never for an EXCHANGE. Excluding EXCHANGE_COMPLETED
// from cancelledStatusValues everywhere would be wrong for those other
// screens, so this is a second, deliberately narrower set defined only here.
// Exported for orders.ts's cancelOrder, whose full-refund decision asks the
// same narrower question ("is any money on this payment still legitimately
// charged?") — see remainingActiveOrders there.
export const nonSettleableStatusValues = cancelledStatusValues.filter(
  (status) => status !== CANCEL_STATUS.EXCHANGE_COMPLETED,
);

// ---------------------------------------------------------------------------
// Period helpers. Every query in this module is scoped to a period, expressed
// internally as [start, end) — end is always exclusive so a date-only "정산
// 기간 종료일" picked by a user can unambiguously include that whole day
// (see parsePeriodRange). Month/day boundaries are KST, not UTC — see
// src/lib/server/kst.ts's header for why this has to match settlement.ts and
// taxInvoice.ts exactly.
// ---------------------------------------------------------------------------

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// The default, no-picker period every "이번 기간" view uses: the 1st of the
// current KST calendar month at 00:00 KST through right now. Using `now` (not
// end-of-month) as the upper bound is deliberate — the month isn't over, and
// nothing dated later than "now" can exist yet, so there's no practical
// difference and this avoids ever implying a future cutoff. Delegates to
// kst.ts's currentKstMonthPeriod (the shared single source of truth for month
// boundaries across payout/settlement/taxInvoice) — kept under this name so
// existing call sites (app/api/admin/settlements/route.ts,
// app/admin/settlements/page.tsx) don't have to change.
export function getCurrentMonthPeriod(now: Date = new Date()): { start: Date; end: Date } {
  return currentKstMonthPeriod(now);
}

// Parses two required "YYYY-MM-DD" strings (an admin-chosen period, KST wall-
// clock dates) into an exclusive [start, end) range of UTC instants. `endStr`
// is the last KST day the admin wants *included*, so it's bumped to the start
// of the following KST day rather than used as-is — using it directly would
// silently drop that entire last day.
export function parsePeriodRange(startStr: string, endStr: string): { start: Date; end: Date } | null {
  const start = parseKstDateOnly(startStr);
  const endDay = parseKstDateOnly(endStr);
  if (!start || !endDay) return null;
  const end = new Date(endDay.getTime() + ONE_DAY_MS);
  if (start.getTime() >= end.getTime()) return null;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Settleable-order predicate + amount math
// ---------------------------------------------------------------------------

// See the module header for why `payment.approvedAt` (not `payment.status`)
// is the discriminator, and why excluding cancelled orders is sufficient on
// its own to also handle partial refunds correctly. The `payment: {...}`
// relation filter alone would already require paymentId to be non-null (an
// order with no payment can't match a relation filter), but `paymentId: {
// not: null }` is kept alongside it to say that requirement explicitly
// rather than lean on an implicit side effect of the other filter.
function settleableInPeriodWhere(periodStart: Date, periodEnd: Date): Prisma.OrderWhereInput {
  return {
    status: { notIn: nonSettleableStatusValues },
    paymentId: { not: null },
    payment: { approvedAt: { gte: periodStart, lt: periodEnd } },
  };
}

interface SettleableOrderAmounts {
  unitPrice: number;
  quantity: number;
  extraShipping: number;
  shippingFee: number;
}

const settleableOrderAmountSelect = {
  unitPrice: true,
  quantity: true,
  extraShipping: true,
  shippingFee: true,
} satisfies Prisma.OrderSelect;

// Single source of truth for gross/commission/net math — see the module
// header (SHIPPING AND COMMISSION, ROUNDING) for the reasoning this encodes.
function summarizeOrders(
  orders: readonly SettleableOrderAmounts[],
  commissionRatePercent: number,
): PayoutAggregate {
  let goodsAmount = 0;
  let extraShippingAmount = 0;
  let shippingFeeAmount = 0;
  for (const order of orders) {
    goodsAmount += order.unitPrice * order.quantity;
    extraShippingAmount += order.extraShipping;
    shippingFeeAmount += order.shippingFee;
  }
  const grossAmount = goodsAmount + extraShippingAmount + shippingFeeAmount;
  const commissionAmount = Math.round((goodsAmount * commissionRatePercent) / 100);
  const netAmount = grossAmount - commissionAmount;
  return { orderCount: orders.length, grossAmount, commissionAmount, netAmount };
}

function toSettlementView(settlement: Settlement): PayoutSettlementView {
  return {
    id: settlement.id,
    periodStart: settlement.periodStart.toISOString(),
    periodEnd: settlement.periodEnd.toISOString(),
    grossAmount: settlement.grossAmount,
    commissionRate: Number(settlement.commissionRate),
    commissionAmount: settlement.commissionAmount,
    adjustmentAmount: settlement.adjustmentAmount,
    netAmount: settlement.netAmount,
    status: settlement.status,
    memo: settlement.memo,
    confirmedAt: settlement.confirmedAt?.toISOString() ?? null,
    paidAt: settlement.paidAt?.toISOString() ?? null,
    createdAt: settlement.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SETTLEMENT CLAWBACK (SettlementAdjustment)
// ---------------------------------------------------------------------------
// A RETURN completing (returns.ts) or an admin cancelling an order
// (orders.ts's cancelOrder, 입금후취소 branch) can both happen AFTER that
// order was already claimed into a CONFIRMED/PAID Settlement — the seller has
// already been paid for it. That Settlement row is a locked-in snapshot (see
// its own schema comment), so it can never be edited after the fact; instead
// this records the money owed back as its own row, absorbed into the NEXT
// settlement confirmPayout creates for that seller (see confirmPayout below).
interface ClawbackOrderInput {
  id: string;
  sellerId: string;
  // Callers must have already checked this is non-null (both call sites do:
  // returns.ts only calls this when `order.settlementId !== null`, same for
  // orders.ts's cancelOrder). Typed as required here so that check can never
  // be silently skipped at a future call site.
  settlementId: string;
  unitPrice: number;
  quantity: number;
  extraShipping: number;
  shippingFee: number;
}

// Records a clawback for one order that already belonged to a settlement.
// Uses the commissionRate that Settlement actually paid the seller with at
// the time — never the seller's CURRENT commissionRate, which may have
// changed since — so the amount recovered exactly matches what was actually
// paid out for this order, not what would be paid out today. Mirrors
// summarizeOrders' commission math exactly (commission only on
// unitPrice*quantity, gross includes shipping) for the same reasoning — see
// the module header's SHIPPING AND COMMISSION section — with one deliberate
// difference: summarizeOrders rounds commission once on a whole batch's
// summed goods amount, while this rounds per order (there is no batch here,
// just the one order being clawed back). The two can therefore disagree by a
// won or two from what the original settlement's batch-rounded commission
// attributed to this specific order; that drift is accepted, not a bug — see
// the report for this task.
//
// Deliberately independent of any buyer-refund clamp (returns.ts's
// clampedAmount, orders.ts's cancelAmount clamp against Toss's remaining
// balance): those answer "how much can we still ask Toss to return to the
// buyer", a question about the payment. This answers "how much did the
// seller keep for this order", a question about the settlement — the two
// numbers are not the same and must not be capped by each other.
export async function createSettlementClawbackForOrder(
  tx: Prisma.TransactionClient,
  order: ClawbackOrderInput,
  reason: string,
): Promise<void> {
  const settlement = await tx.settlement.findUniqueOrThrow({
    where: { id: order.settlementId },
    select: { commissionRate: true },
  });
  const commissionRate = Number(settlement.commissionRate);
  const goodsAmount = order.unitPrice * order.quantity;
  const commissionAmount = Math.round((goodsAmount * commissionRate) / 100);
  const grossAmount = goodsAmount + order.extraShipping + order.shippingFee;
  const amount = -(grossAmount - commissionAmount);

  await tx.settlementAdjustment.create({
    data: {
      sellerId: order.sellerId,
      orderId: order.id,
      amount,
      reason,
    },
  });
}

// Sum of one seller's not-yet-absorbed clawbacks (settlementId still null —
// see confirmPayout for when this becomes non-null). Always <= 0. Used both
// to preview "what would this seller's net payout include if confirmed right
// now" (getSellerUnsettledSummary, getAdminUnsettledBySeller) and to actually
// absorb the backlog at confirm time (confirmPayout) — kept as one function
// so the preview a seller/admin sees before confirming can never drift from
// what confirmPayout itself queries.
async function getPendingAdjustmentTotal(sellerId: string): Promise<number> {
  const result = await prisma.settlementAdjustment.aggregate({
    where: { sellerId, settlementId: null },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

// ---------------------------------------------------------------------------
// TASK 2 — 판매자 화면
// ---------------------------------------------------------------------------

// Scoped to one seller's current-month orders only — small and bounded like
// getTaxAggregate/getDeposits/getExtraFees in settlement.ts, not the
// "every order in Node" pattern Task 3's cross-seller queries must avoid.
//
// unsettled.netAmount already folds in adjustmentAmount (the seller's
// not-yet-absorbed clawback backlog, NOT scoped to this period — see
// getPendingAdjustmentTotal and confirmPayout, which absorbs the whole
// backlog regardless of period the same way) so this preview matches exactly
// what confirmPayout would actually produce if confirmed right now.
// adjustmentAmount is additionally exposed on its own so the screen can
// explain the gap between grossAmount - commissionAmount and netAmount
// instead of just silently not adding up.
export async function getSellerUnsettledSummary(sellerId: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { commissionRate: true },
  });
  if (!seller) return null;

  const { start, end } = getCurrentMonthPeriod();
  const [orders, adjustmentAmount] = await Promise.all([
    prisma.order.findMany({
      where: { ...settleableInPeriodWhere(start, end), sellerId, settlementId: null },
      select: settleableOrderAmountSelect,
    }),
    getPendingAdjustmentTotal(sellerId),
  ]);

  const commissionRate = Number(seller.commissionRate);
  const orderAggregate = summarizeOrders(orders, commissionRate);
  return {
    period: { start, end },
    commissionRate,
    adjustmentAmount,
    unsettled: { ...orderAggregate, netAmount: orderAggregate.netAmount + adjustmentAmount },
  };
}

export async function getSellerSettlements(sellerId: string): Promise<PayoutSettlementView[]> {
  const settlements = await prisma.settlement.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
  });
  return settlements.map(toSettlementView);
}

// ---------------------------------------------------------------------------
// TASK 3 — 관리자 화면
// ---------------------------------------------------------------------------

// Raw SQL, deliberately: gross depends on `unitPrice * quantity`, a product of
// two columns Prisma's groupBy/aggregate cannot sum directly (their `_sum`
// only totals a single stored column, never an expression). The alternative
// that stays inside the plain Prisma API — `findMany` every matching order
// and reduce in Node — is exactly what the task requires this admin,
// cross-every-seller query must NOT do (a bounded, single-seller version of
// that is fine, see getSellerUnsettledSummary above). A parameterized
// `$queryRaw` with `GROUP BY "sellerId"` still returns at most one row per
// seller, computed entirely in Postgres. This is an established pattern in
// this codebase already — see the catalog aggregation queries in
// src/lib/server/products.ts, which uses the same `Prisma.sql`/`Prisma.join`
// tagged-template approach for the same reason (no expression aggregates in
// the high-level client API).
interface UnsettledSellerAggregateRow {
  seller_id: string;
  order_count: number;
  goods_amount: number;
  extra_shipping_amount: number;
  shipping_fee_amount: number;
}

export async function getAdminUnsettledBySeller(
  periodStart: Date,
  periodEnd: Date,
): Promise<AdminUnsettledSellerRow[]> {
  const rows = await prisma.$queryRaw<UnsettledSellerAggregateRow[]>(Prisma.sql`
    SELECT
      o."sellerId" AS seller_id,
      COUNT(*)::int AS order_count,
      SUM(o."unitPrice" * o."quantity")::int AS goods_amount,
      SUM(o."extraShipping")::int AS extra_shipping_amount,
      SUM(o."shippingFee")::int AS shipping_fee_amount
    FROM "Order" o
    JOIN "Payment" p ON p.id = o."paymentId"
    WHERE o."settlementId" IS NULL
      AND o.status NOT IN (${Prisma.join(nonSettleableStatusValues)})
      AND p."approvedAt" IS NOT NULL
      AND p."approvedAt" >= ${periodStart}
      AND p."approvedAt" < ${periodEnd}
    GROUP BY o."sellerId"
  `);

  // Not period-scoped, deliberately — confirmPayout absorbs a seller's ENTIRE
  // not-yet-absorbed clawback backlog regardless of which period is being
  // confirmed (see confirmPayout), so this has to show the same backlog a
  // confirm right now would actually claim. Separate groupBy + merge (not a
  // join into the raw query above) specifically so a seller with adjustments
  // but zero unsettled orders this period still gets a row — otherwise their
  // debt would be invisible on this screen until they happened to have a new
  // order in some future period.
  const adjustmentRows = await prisma.settlementAdjustment.groupBy({
    by: ["sellerId"],
    where: { settlementId: null },
    _sum: { amount: true },
  });
  const adjustmentBySeller = new Map(adjustmentRows.map((row) => [row.sellerId, row._sum.amount ?? 0] as const));

  const sellerIds = new Set<string>([...rows.map((row) => row.seller_id), ...adjustmentBySeller.keys()]);
  if (sellerIds.size === 0) return [];

  // Small, bounded follow-up (at most one row per seller that actually has
  // unsettled orders and/or a pending adjustment) — not the "every order"
  // pattern, just "every seller with something pending".
  const sellers = await prisma.seller.findMany({
    where: { id: { in: [...sellerIds] } },
    select: { id: true, code: true, commissionRate: true, user: { select: { businessName: true } } },
  });
  const sellerById = new Map(sellers.map((seller) => [seller.id, seller] as const));
  const orderRowBySeller = new Map(rows.map((row) => [row.seller_id, row] as const));

  const result: AdminUnsettledSellerRow[] = [];
  for (const sellerId of sellerIds) {
    // Order.sellerId / SettlementAdjustment.sellerId are both required FKs to
    // Seller, so a missing lookup here would mean a broken FK — defensive
    // only, never expected to trigger.
    const seller = sellerById.get(sellerId);
    if (!seller) continue;

    const orderRow = orderRowBySeller.get(sellerId);
    const goodsAmount = orderRow?.goods_amount ?? 0;
    const grossAmount = goodsAmount + (orderRow?.extra_shipping_amount ?? 0) + (orderRow?.shipping_fee_amount ?? 0);
    const commissionRate = Number(seller.commissionRate);
    const commissionAmount = Math.round((goodsAmount * commissionRate) / 100);
    const adjustmentAmount = adjustmentBySeller.get(sellerId) ?? 0;
    result.push({
      sellerId: seller.id,
      sellerCode: seller.code,
      businessName: seller.user.businessName,
      commissionRate,
      orderCount: orderRow?.order_count ?? 0,
      grossAmount,
      commissionAmount,
      adjustmentAmount,
      // Folds in the pending clawback backlog, same as
      // getSellerUnsettledSummary — see that function's comment. A seller
      // with only adjustments and no unsettled orders this period gets
      // orderCount 0 / grossAmount 0 / commissionAmount 0 and netAmount ==
      // adjustmentAmount (negative), which is exactly the outstanding debt.
      netAmount: grossAmount - commissionAmount + adjustmentAmount,
    });
  }
  return result;
}

const adminSettlementInclude = {
  seller: { select: { id: true, code: true, user: { select: { businessName: true } } } },
} satisfies Prisma.SettlementInclude;

type AdminSettlementRecord = Prisma.SettlementGetPayload<{ include: typeof adminSettlementInclude }>;

function toAdminSettlementView(settlement: AdminSettlementRecord): AdminPayoutSettlementView {
  return {
    ...toSettlementView(settlement),
    seller: {
      id: settlement.seller.id,
      code: settlement.seller.code,
      businessName: settlement.seller.user.businessName,
    },
  };
}

export async function getAdminSettlements(status?: string): Promise<AdminPayoutSettlementView[]> {
  const validStatus = status && Object.values(SettlementStatus).includes(status as SettlementStatus)
    ? (status as SettlementStatus)
    : undefined;
  const settlements = await prisma.settlement.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    orderBy: { createdAt: "desc" },
    include: adminSettlementInclude,
  });
  return settlements.map(toAdminSettlementView);
}

export const confirmPayoutSchema = z.object({
  sellerId: z.string().trim().min(1),
  periodStart: z.string().regex(DATE_ONLY_RE, "YYYY-MM-DD 형식이어야 합니다."),
  periodEnd: z.string().regex(DATE_ONLY_RE, "YYYY-MM-DD 형식이어야 합니다."),
  memo: z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().max(500).optional()),
});

// Internal-only control-flow signal — never returned or thrown past this
// function. Prisma only rolls back a $transaction when its callback throws,
// but confirmPayout's public contract is the { kind: "..." } discriminated
// style admin.ts uses (per this task's house-style instructions), not a
// thrown domain error that reaches the route handler. So this is caught
// immediately below and converted into { kind: "CLAIM_CONFLICT" } — the throw
// is purely how the already-created Settlement row gets undone.
class PayoutClaimConflict extends Error {}

export type ConfirmPayoutResult =
  | { kind: "SELLER_NOT_FOUND" }
  | { kind: "NO_SETTLEABLE_ORDERS" }
  | { kind: "CLAIM_CONFLICT" }
  | { kind: "OK"; settlement: PayoutSettlementView; claimedOrderCount: number };

// Computes the live settleable/unsettled total for (sellerId, [periodStart,
// periodEnd)), snapshots it into a new CONFIRMED Settlement row, and stamps
// settlementId onto exactly the orders the snapshot was computed from — all
// in one transaction. See the module header (DOUBLE-CLAIM GUARD) for why the
// claim step re-checks both settlementId and status rather than trusting the
// initial read, and why a count mismatch aborts the whole transaction instead
// of saving a Settlement whose numbers don't match what it actually claimed.
//
// Lands directly on CONFIRMED rather than lingering at PENDING: this app has
// no scheduler/cron (see UNPAID_ORDER_TTL_MS's lazy-expiry comment in
// orders.ts for why — this deployment has no background worker at all), so
// there is no automated process that ever drafts a Settlement for a human to
// review later. The only way one is ever created is this admin action, and
// the admin is already looking at the live 미정산 집계 numbers on screen
// before clicking confirm — creation and confirmation are the same moment in
// practice. PENDING stays a valid, reachable enum value in the schema (e.g.
// for a future automated draft step) but this code path never produces one.
export async function confirmPayout(
  sellerId: string,
  periodStart: Date,
  periodEnd: Date,
  adminId: string,
  memo: string | null,
): Promise<ConfirmPayoutResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const seller = await tx.seller.findUnique({
        where: { id: sellerId },
        select: { commissionRate: true },
      });
      if (!seller) return { kind: "SELLER_NOT_FOUND" as const };

      const candidates = await tx.order.findMany({
        where: { ...settleableInPeriodWhere(periodStart, periodEnd), sellerId, settlementId: null },
        select: { id: true, ...settleableOrderAmountSelect },
      });
      // Adjustments alone (no settleable orders this period) do NOT trigger a
      // settlement here — an admin still has to confirm a period that
      // actually has orders in it. The backlog isn't lost: it just keeps
      // accumulating (still settlementId: null) until a period with at least
      // one settleable order for this seller gets confirmed, at which point
      // it's absorbed in full below. See the report for this task.
      if (candidates.length === 0) return { kind: "NO_SETTLEABLE_ORDERS" as const };

      const commissionRate = Number(seller.commissionRate);
      const { grossAmount, commissionAmount, netAmount: orderNetAmount } = summarizeOrders(candidates, commissionRate);

      // Absorb this seller's ENTIRE not-yet-absorbed clawback backlog into
      // this settlement — not just clawbacks tied to orders in this period's
      // candidate set. A clawback's order already belongs to a PAST
      // settlement (that's what makes it a clawback); it has nothing to do
      // with periodStart/periodEnd, so there is no period to scope this
      // query to. Read before the claim below for the same double-claim-guard
      // reason candidates is read before its own claim — see the module
      // header.
      const pendingAdjustments = await tx.settlementAdjustment.findMany({
        where: { sellerId, settlementId: null },
        select: { id: true, amount: true },
      });
      const adjustmentAmount = pendingAdjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
      // netAmount can go negative here — a seller whose clawback backlog
      // exceeds this period's gross-minus-commission ends up owing the
      // platform rather than being owed. Allowed on purpose: this app has no
      // separate "seller owes platform" ledger, so a negative netAmount
      // *is* that ledger entry, carried forward as-is for an admin to see
      // and act on (e.g. net it against next period, or collect out of
      // band) rather than silently clamped to 0 and quietly forgiven.
      const netAmount = orderNetAmount + adjustmentAmount;

      const settlement = await tx.settlement.create({
        data: {
          sellerId,
          periodStart,
          periodEnd,
          grossAmount,
          commissionRate,
          commissionAmount,
          adjustmentAmount,
          netAmount,
          status: "CONFIRMED",
          memo,
          confirmedAt: new Date(),
        },
      });

      const claim = await tx.order.updateMany({
        where: {
          id: { in: candidates.map((order) => order.id) },
          settlementId: null,
          status: { notIn: nonSettleableStatusValues },
        },
        data: { settlementId: settlement.id },
      });
      if (claim.count !== candidates.length) {
        throw new PayoutClaimConflict();
      }

      // Same double-claim guard shape as the order claim above: re-check
      // `settlementId: null` at claim time (not trusted from the read above)
      // and abort the whole transaction on a count mismatch, rather than
      // save a Settlement whose adjustmentAmount doesn't match what it
      // actually claimed.
      const adjustmentClaim = await tx.settlementAdjustment.updateMany({
        where: { sellerId, settlementId: null },
        data: { settlementId: settlement.id },
      });
      if (adjustmentClaim.count !== pendingAdjustments.length) {
        throw new PayoutClaimConflict();
      }

      await tx.adminActionLog.create({
        data: {
          adminId,
          action: "SETTLEMENT_CONFIRM",
          targetType: "Settlement",
          targetId: settlement.id,
          reason: memo,
        },
      });

      return { kind: "OK" as const, settlement: toSettlementView(settlement), claimedOrderCount: claim.count };
    });
  } catch (error) {
    if (error instanceof PayoutClaimConflict) return { kind: "CLAIM_CONFLICT" as const };
    throw error;
  }
}

export type MarkPayoutPaidResult =
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_STATUS"; status: SettlementStatus }
  | { kind: "OK"; settlement: PayoutSettlementView };

export async function markPayoutPaid(settlementId: string, adminId: string): Promise<MarkPayoutPaidResult> {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement) return { kind: "NOT_FOUND" as const };
    if (settlement.status !== "CONFIRMED") {
      return { kind: "INVALID_STATUS" as const, status: settlement.status };
    }

    // Guarded updateMany on the settlement's own current status — same
    // lost-the-race pattern as the claim step above, so a concurrent
    // double-payout call can't have the second silently overwrite the first.
    const marked = await tx.settlement.updateMany({
      where: { id: settlementId, status: "CONFIRMED" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (marked.count !== 1) return { kind: "INVALID_STATUS" as const, status: settlement.status };

    const updated = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "SETTLEMENT_MARK_PAID",
        targetType: "Settlement",
        targetId: settlementId,
      },
    });
    return { kind: "OK" as const, settlement: toSettlementView(updated) };
  });
}
