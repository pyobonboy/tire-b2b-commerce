import { NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";
import { CANCEL_STATUS } from "@/lib/order-status";
import type {
  DepositEntry,
  ExtraFeeEntry,
  SettlementView,
  TaxMonthEntry,
} from "@/lib/settlement-types";
import { kstMonthString } from "./kst";
import { prisma } from "./prisma";

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

const cancelledStatusValues = Object.values(CANCEL_STATUS);

// Same "타이어" / "타이어 외 N건" convention /api/payments/toss/prepare uses to
// build the Toss orderName for a payment (see that route's `orderName`
// line) — reused as-is here rather than inventing a second label for the
// same concept, since a payment's 주문상품 label is exactly that orderName.
function paymentItemLabel(orderCount: number) {
  return orderCount <= 1 ? "타이어" : `타이어 외 ${orderCount - 1}건`;
}

const buyerPaymentInclude = {
  // orderNo 는 입출금내역의 "통합주문번호"를 사람이 읽는 값으로 보여주기 위해,
  // id 는 결제에 묶인 주문 개수(itemLabel)를 세기 위해 필요하다.
  orders: { select: { id: true, orderNo: true } },
} satisfies Prisma.PaymentInclude;

type BuyerPaymentRecord = Prisma.PaymentGetPayload<{
  include: typeof buyerPaymentInclude;
}>;

// Distinguishes 환불완료 from 환불예정/처리중 for one Payment row. See the
// refundRequiredAt/refundReason handling in cancelOrder and
// settleOrderRefundViaToss (src/lib/server/orders.ts):
//   - refundAmount > 0 && refundRequiredAt === null && status === "CANCELED"
//     only happens once settleOrderRefundViaToss records that Toss's cancel
//     call for the LAST active order on this payment actually returned
//     success (refundReason "FULLY_REFUNDED_VIA_TOSS_CANCEL") with no
//     earlier unresolved failure outstanding. That is the only path that
//     both clears refundRequiredAt and flips status to CANCELED, so it is
//     the only state that may be shown as "환불완료".
//   - Cancelling one order out of several on the same payment (부분 취소) is
//     now ALSO auto-submitted to Toss, one order at a time — see
//     settleOrderRefundViaToss — but that never sets status to "CANCELED"
//     (the payment still has other active orders, or an earlier refund
//     attempt on it is still unresolved), so refundCompleted here stays
//     false regardless of refundRequiredAt. This is the load-bearing reason
//     a partially-refunded payment can never misreport as "환불완료": the
//     condition below requires status === "CANCELED", which nothing but a
//     genuine full settlement ever sets.
//   - refundAmount > 0 with refundRequiredAt still set means money is owed
//     but has not (fully) left this payment yet — a partial or full Toss
//     cancel attempt that is still pending, failed (refundReason
//     "AUTO_REFUND_FAILED_NEEDS_MANUAL_TOSS_CANCEL"), or was deliberately
//     superseded by a newer cancellation before its flag could be cleared.
//     All of these must read as pending, never as completed, or this screen
//     would state a refund happened when the buyer's money hasn't actually
//     moved (or has only partly moved).
function toDepositEntry(payment: BuyerPaymentRecord): DepositEntry {
  const hasRefund = payment.refundAmount > 0;
  // Settled means "Toss actually returned this money", and it comes in two
  // shapes that must not be collapsed into one another:
  //   - the whole payment was reversed  -> status CANCELED, reason FULLY_...
  //   - some orders were reversed while others stay live -> status remains
  //     DONE (there is still an active charge), reason PARTIALLY_...
  // Both clear refundRequiredAt, which is what distinguishes them from a
  // refund that is merely owed or that failed. Reporting a settled partial
  // refund as PENDING would tell a buyer whose money is already back that it
  // is still being processed — forever, since such a payment never becomes
  // CANCELED. See settleOrderRefundViaToss in orders.ts for who writes these.
  const settled = hasRefund && payment.refundRequiredAt === null;
  const refundStatus: DepositEntry["refundStatus"] = !hasRefund
    ? "NONE"
    : !settled
      ? "PENDING"
      : payment.status === "CANCELED"
        ? "COMPLETED"
        : "PARTIAL";
  const refundStatusLabel =
    refundStatus === "NONE"
      ? "-"
      : refundStatus === "COMPLETED"
        ? "환불완료"
        : refundStatus === "PARTIAL"
          ? "부분환불 완료"
          : "환불예정(처리중)";

  return {
    paymentId: payment.id,
    tossOrderId: payment.tossOrderId,
    orderNos: payment.orders
      .map((order) => order.orderNo)
      .filter((orderNo): orderNo is string => orderNo !== null),
    itemLabel: paymentItemLabel(payment.orders.length),
    paidAmount: payment.amount,
    refundAmount: payment.refundAmount,
    refundStatus,
    refundStatusLabel,
    date: (payment.approvedAt ?? payment.requestedAt).toISOString(),
  };
}

async function getDeposits(buyerId: string) {
  // What belongs in an 입출금 내역 is "Toss actually approved a charge", and
  // `status` alone does NOT answer that — three different code paths set
  // CANCELED and only one of them involves money that ever moved:
  //   1. settleOrderRefundViaToss (orders.ts) — was DONE, charged, then
  //      Toss's cancel succeeded (in full or in part). Real: charged then
  //      returned. Belongs here.
  //   2. confirm/route.ts's DB_SAVE_FAILED_AUTO_CANCELED — the charge was
  //      reversed before this payment was ever recorded as approved, so it
  //      nets to zero and its approvedAt was never set.
  //   3. prepare/route.ts's SUPERSEDED_BY_NEW_PAYMENT_PREPARE — a still-READY
  //      payment closed out because the buyer re-opened the payment page for
  //      the same orders. NOTHING WAS EVER CHARGED. This fires on an ordinary
  //      page refresh, so filtering on status alone would print a phantom
  //      "결제 {amount}원" row on this screen every time a buyer reopened
  //      checkout — reintroducing exactly the fabricated-money problem this
  //      screen was rewritten to remove.
  // `approvedAt` is the honest discriminator: it is set only by the two
  // confirm-route writes that follow a successful Toss approval, and nothing
  // ever clears it. READY/FAILED payments never have it either, so this one
  // condition covers every never-charged case on its own.
  const payments = await prisma.payment.findMany({
    where: { buyerId, status: { in: ["DONE", "CANCELED"] }, approvedAt: { not: null } },
    orderBy: [{ approvedAt: "desc" }, { requestedAt: "desc" }],
    include: buyerPaymentInclude,
  });

  const deposits = payments.map(toDepositEntry);
  // 합계 nets out every refund whose money has actually moved, which is both
  // COMPLETED (whole payment reversed) and PARTIAL (some orders reversed,
  // others still live). PENDING is deliberately excluded — a refund that is
  // only owed has not left anything yet, so subtracting it would understate
  // what the buyer was really charged. Counting COMPLETED alone would make
  // the opposite error and overstate the total for anyone who has had a
  // partial refund settled.
  const settledRefund = (d: DepositEntry) =>
    d.refundStatus === "COMPLETED" || d.refundStatus === "PARTIAL" ? d.refundAmount : 0;
  const depositsTotal = deposits.reduce((sum, d) => sum + d.paidAmount - settledRefund(d), 0);
  return { deposits, depositsTotal };
}

interface PaidOrderMonthlyAmount {
  month: string;
  total: number;
}

/**
 * Shared primitive behind both getTaxAggregate below and
 * getBuyerMonthPaidTotal (exported for taxInvoice.ts / Task 2 — see that
 * function's own comment). "실제로 결제된" orders only: the order itself must
 * not be cancelled, and it must sit on a payment that is currently DONE
 * (still an active charge). An order whose payment was fully refunded
 * (CANCELED) is always also cancelled itself (cancelOrder only marks a
 * payment's full refund once every order on it is cancelled), so excluding
 * cancelled orders already excludes that revenue — nothing here
 * double-counts a refunded sale as if it were still taxable turnover.
 */
async function getBuyerPaidOrderMonthlyAmounts(buyerId: string): Promise<PaidOrderMonthlyAmount[]> {
  const paidOrders = await prisma.order.findMany({
    where: {
      buyerId,
      paymentId: { not: null },
      status: { notIn: cancelledStatusValues },
      payment: { status: "DONE" },
    },
    select: {
      unitPrice: true,
      quantity: true,
      extraShipping: true,
      shippingFee: true,
      orderedAt: true,
      payment: { select: { approvedAt: true } },
    },
  });

  return paidOrders.map((order) => {
    // shippingFee 를 반드시 포함해야 한다. 이 화면이 보여주는 월별 공급가액·
    // 부가세는 "구매자가 실제로 청구받은 금액"의 집계여야 하는데, 배송비는
    // 결제·환불·판매자 정산 어디에서나 청구액의 일부로 계산된다(prepare 의
    // 결제 금액, cancelOrder 의 환불 금액, payout 의 gross). 여기서만 빼면
    // 세무 참고용으로 쓰는 숫자가 실제 청구액보다 배송비만큼 적게 나온다.
    const total = order.unitPrice * order.quantity + order.extraShipping + order.shippingFee;
    const paidAt = order.payment?.approvedAt ?? order.orderedAt;
    return { month: kstMonthString(paidAt), total }; // month: "YYYY-MM" (KST calendar month)
  });
}

// Standard Korean 부가세 breakdown (합계 = 공급가액 + 부가세, VAT 10%). This
// app only ever stores a tax-inclusive order total — there is no per-line
// supply/VAT split anywhere — so 공급가액 is backed out of the total rather
// than computed independently. That keeps every row internally consistent
// (공급가액 + 부가세 === 합계 exactly), which matters more for a 집계
// reference screen (and a TaxInvoice snapshot — see taxInvoice.ts) than
// matching some externally-issued invoice's rounding.
function splitSupplyAndVat(total: number): { supplyAmount: number; vat: number } {
  const supplyAmount = Math.round(total / 1.1);
  return { supplyAmount, vat: total - supplyAmount };
}

async function getTaxAggregate(buyerId: string) {
  const amounts = await getBuyerPaidOrderMonthlyAmounts(buyerId);

  const monthlyTotals = new Map<string, number>();
  for (const { month, total } of amounts) {
    monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + total);
  }

  const taxByYear: Record<string, TaxMonthEntry[]> = {};
  for (const [month, total] of monthlyTotals) {
    const { supplyAmount, vat } = splitSupplyAndVat(total);
    const year = month.slice(0, 4);
    (taxByYear[year] ??= []).push({ month, supplyAmount, vat, total });
  }
  for (const year of Object.keys(taxByYear)) {
    taxByYear[year].sort((a, b) => (a.month < b.month ? -1 : 1));
  }
  const taxYears = Object.keys(taxByYear).sort((a, b) => Number(b) - Number(a));

  return { taxYears, taxByYear };
}

/**
 * Task 2 (세금계산서) — the exact same paid-order computation getTaxAggregate
 * uses above, narrowed to one buyer + one calendar month, so a requested tax
 * invoice's supplyAmount/vat/totalAmount can never be a second formula that
 * silently drifts from what this buyer's own 세금계산서 내역 aggregate shows
 * for that month. Returns null when there are no paid orders in that month
 * at all (distinct from "paid orders summing to a total of 0", which cannot
 * actually happen — unitPrice * quantity is always positive — but checking
 * array length rather than the summed total keeps that distinction correct
 * in principle). See requestTaxInvoice in taxInvoice.ts, the only caller.
 */
export async function getBuyerMonthPaidTotal(
  buyerId: string,
  month: string,
): Promise<{ supplyAmount: number; vat: number; total: number } | null> {
  const amounts = (await getBuyerPaidOrderMonthlyAmounts(buyerId)).filter((amount) => amount.month === month);
  if (amounts.length === 0) return null;
  const total = amounts.reduce((sum, amount) => sum + amount.total, 0);
  return { total, ...splitSupplyAndVat(total) };
}

async function getExtraFees(buyerId: string) {
  // Order.extraShipping is the only additional-cost field this schema has.
  // Cancelled orders are excluded: a cancelled order's extra fee was either
  // never actually charged (cancelled before payment) or is already folded
  // into that payment's refundAmount (cancelled after payment) — showing it
  // again here as a live extra charge would double up on money already
  // accounted for on the deposits screen.
  const orders = await prisma.order.findMany({
    where: { buyerId, extraShipping: { gt: 0 }, status: { notIn: cancelledStatusValues } },
    orderBy: { orderedAt: "desc" },
    include: { listing: { include: { product: true } } },
  });

  const extraFees: ExtraFeeEntry[] = orders.map((order) => ({
    orderId: order.id,
    orderNo: order.orderNo,
    itemLabel: `${order.listing.product.manufacturer} ${order.listing.product.model}`,
    extraShipping: order.extraShipping,
    orderedAt: order.orderedAt.toISOString(),
  }));
  const extraFeesTotal = extraFees.reduce((sum, e) => sum + e.extraShipping, 0);
  return { extraFees, extraFeesTotal };
}

const EMPTY_SETTLEMENT: Omit<SettlementView, "scope" | "scopeMessage"> = {
  deposits: [],
  depositsTotal: 0,
  taxYears: [],
  taxByYear: {},
  extraFees: [],
  extraFeesTotal: 0,
};

export async function getSettlementView(userId: string, role: Role): Promise<SettlementView> {
  // Only a BUYER-role account can ever hold Payment rows or place Order rows
  // (enforced by requireRole(["BUYER"]) on /api/orders and every
  // /api/payments/toss/* route) — a SELLER or ADMIN session has zero rows
  // here by construction, not because of a bug or a missing query. Skip the
  // queries entirely and say so, rather than rendering tables that look
  // empty by accident.
  if (role !== "BUYER") {
    return {
      scope: "NOT_APPLICABLE",
      scopeMessage:
        "입출금·세금계산서·추가비용 내역은 구매(결제) 계정 기준으로 집계됩니다. 현재 계정은 결제 내역을 보유하지 않는 역할이라 표시할 내역이 없습니다.",
      ...EMPTY_SETTLEMENT,
    };
  }

  const [{ deposits, depositsTotal }, { taxYears, taxByYear }, { extraFees, extraFeesTotal }] =
    await Promise.all([getDeposits(userId), getTaxAggregate(userId), getExtraFees(userId)]);

  return {
    scope: "BUYER",
    scopeMessage: null,
    deposits,
    depositsTotal,
    taxYears,
    taxByYear,
    extraFees,
    extraFeesTotal,
  };
}
