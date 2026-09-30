import type { ShippingStatus } from "@prisma/client";

export const ORDER_STATUS = {
  PAYMENT_PENDING: "입금대기",
  PAYMENT_COMPLETED: "입금완료",
  ORDER_CONFIRMED: "주문확인",
  SHIPPING_PREPARING: "배송준비중",
  SHIPPING: "배송중",
  SHIPPING_COMPLETED: "배송완료",
  PURCHASE_CONFIRMED: "구매확정",
} as const;

export type OrderStatusValue = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const CANCEL_STATUS = {
  PAYMENT_AFTER: "입금후취소",
  PAYMENT_BEFORE: "입금전취소",
  EXCHANGE_COMPLETED: "교환완료",
  RETURN_COMPLETED: "반품완료",
  OUT_OF_STOCK: "재고없음",
  NOT_DELIVERED: "상품미도착",
} as const;

export const SHIPPING_STATUS_LABEL: Record<ShippingStatus, string> = {
  PREPARING: "배송준비중",
  TRACKING_REGISTERED: "송장번호입력",
  SHIPPED: "발송완료",
  DELIVERED: "배송완료",
};

export function isCancelledOrderStatus(status: string) {
  return Object.values(CANCEL_STATUS).includes(status as (typeof CANCEL_STATUS)[keyof typeof CANCEL_STATUS]);
}

// Rank of every non-cancelled order.status value, in the order the owner
// decided they must always progress through (연동 방식): payment, then the
// seller's optional explicit 주문확인, then the three shipping milestones,
// then the buyer's 구매확정. Both updateSellerShipping (seller.ts) and
// updateAdminShipping (admin.ts) go through nextOrderStatusForShipping below,
// which consults this table, so order.status can never be dragged backwards
// by either path, and the two paths cannot drift apart on how far "backwards"
// means. Cancelled statuses (CANCEL_STATUS values) deliberately have no entry
// here - see nextOrderStatusForShipping for what that implies.
export const orderStatusRank: Record<OrderStatusValue, number> = {
  [ORDER_STATUS.PAYMENT_PENDING]: 0,
  [ORDER_STATUS.PAYMENT_COMPLETED]: 1,
  [ORDER_STATUS.ORDER_CONFIRMED]: 2,
  [ORDER_STATUS.SHIPPING_PREPARING]: 3,
  [ORDER_STATUS.SHIPPING]: 4,
  [ORDER_STATUS.SHIPPING_COMPLETED]: 5,
  [ORDER_STATUS.PURCHASE_CONFIRMED]: 6,
};

// The owner's chosen 연동 방식 mapping: advancing Order.shippingStatus must
// also advance order.status. PREPARING has no entry - payment (not shipping)
// is what sets 입금완료, so there is deliberately no "shippingStatus ->
// order.status" transition for it. 주문확인 also has no entry: it has no
// shipping trigger at all and is only ever reached through the seller's
// explicit "주문확인" action (see confirmSellerOrder in seller.ts), never as
// a side effect of a shipping update.
const SHIPPING_STATUS_TO_ORDER_STATUS: Partial<Record<ShippingStatus, OrderStatusValue>> = {
  TRACKING_REGISTERED: ORDER_STATUS.SHIPPING_PREPARING,
  SHIPPED: ORDER_STATUS.SHIPPING,
  DELIVERED: ORDER_STATUS.SHIPPING_COMPLETED,
};

// Single shared place updateSellerShipping (seller.ts) and updateAdminShipping
// (admin.ts) both call to compute the order.status a shipping transition
// should produce, so the seller and admin paths cannot drift apart on this
// mapping. Returns null when there's nothing to advance to:
//   - shippingStatus is PREPARING (no mapped target), or
//   - the mapped target isn't actually ahead of currentStatus - already
//     reached it, or currentStatus is a *later* state than the shipping
//     transition would imply (e.g. an admin re-registering tracking on an
//     already-DELIVERED order must not roll order.status from 구매확정/
//     배송완료 back down to 배송준비중), or
//   - currentStatus isn't a ranked ORDER_STATUS value at all. A cancelled
//     order's status string (입금전취소/입금후취소) has no entry in
//     orderStatusRank, so this returns null for that too - but callers that
//     specifically need to know "is this order cancelled" should still check
//     isCancelledOrderStatus themselves (updateAdminShipping does, since it
//     has no earlier guard that would otherwise guarantee currentStatus is
//     non-cancelled by the time this runs) rather than lean on this as an
//     implicit cancellation check.
export function nextOrderStatusForShipping(
  currentStatus: string,
  shippingStatus: ShippingStatus,
): OrderStatusValue | null {
  const target = SHIPPING_STATUS_TO_ORDER_STATUS[shippingStatus];
  if (!target) return null;
  const currentRank = orderStatusRank[currentStatus as OrderStatusValue];
  if (currentRank === undefined || currentRank >= orderStatusRank[target]) return null;
  return target;
}
