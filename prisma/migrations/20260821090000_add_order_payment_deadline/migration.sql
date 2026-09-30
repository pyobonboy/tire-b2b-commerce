-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentDeadline" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_status_paymentDeadline_idx" ON "Order"("status", "paymentDeadline");

-- Backfill: expireStaleUnpaidOrders() selects on `paymentDeadline < now()`,
-- and in SQL a NULL never satisfies that comparison. Without this backfill
-- every 입금대기 order that already exists when this migration runs would be
-- permanently exempt from expiry and would hold its Listing.stock forever --
-- i.e. exactly the bug this column exists to fix, grandfathered in for all
-- pre-existing rows.
--
-- The deadline is derived from each order's own `orderedAt` (+ the 30 minute
-- UNPAID_ORDER_TTL_MS in src/lib/server/orders.ts) rather than from the
-- deploy time, so an order's age is judged the same way before and after this
-- migration. Consequence to be aware of when deploying: any 입금대기 order
-- already older than 30 minutes becomes immediately eligible for expiry and
-- will be auto-cancelled (with its stock restored) the first time a buyer,
-- seller, or admin order list is read.
-- Orders whose shipping has already started are deliberately EXCLUDED. Before
-- the seller-side guard existed, a seller could mark an unpaid (입금대기)
-- order as 송장번호입력/발송완료/배송완료, so such rows can exist. Giving one
-- of those a past deadline would let expireStaleUnpaidOrders auto-cancel it
-- and increment the listing's stock back for a tire that physically left the
-- warehouse. Those rows are left with a NULL deadline (never auto-expired) so
-- an admin resolves them by hand instead.
UPDATE "Order"
SET "paymentDeadline" = "orderedAt" + INTERVAL '30 minutes'
WHERE "paymentDeadline" IS NULL
  AND "status" = '입금대기'
  AND "shippingStatus" = '배송준비중';
