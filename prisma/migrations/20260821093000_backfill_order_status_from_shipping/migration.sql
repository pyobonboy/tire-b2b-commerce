-- Data-only migration. No schema change.
--
-- Until the 연동 change (see nextOrderStatusForShipping in
-- src/lib/order-status.ts) nothing ever wrote 주문확인/배송준비중/배송중/
-- 배송완료/구매확정 to Order.status: shipping progress lived only on
-- Order.shippingStatus, and status stopped at 입금완료. Every row that
-- already exists therefore reports 입금완료 no matter how far its shipping
-- actually got.
--
-- Without this backfill the newly-correct 주문 현황 dashboard would still show
-- a delivered order as 입금완료 forever for all pre-existing data, and
-- cancelOrder's status-rank guard would read those orders as not-yet-shipped.
--
-- Only rows currently at 입금완료 are touched, so this can never move an
-- order backwards, never overwrite a cancelled status (입금전취소/입금후취소
-- etc.), and never touch 입금대기. Orders that were shipped while still
-- unpaid are intentionally NOT promoted here — they are a data problem an
-- admin must resolve, not something to paper over by marking them shipped.
UPDATE "Order"
SET "status" = CASE "shippingStatus"
  WHEN '송장번호입력' THEN '배송준비중'
  WHEN '발송완료'     THEN '배송중'
  WHEN '배송완료'     THEN '배송완료'
END
WHERE "status" = '입금완료'
  AND "shippingStatus" <> '배송준비중';
