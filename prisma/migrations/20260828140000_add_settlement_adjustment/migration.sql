-- 정산 후 회수(클로백) 스펙: 정산·지급이 끝난 주문이 나중에 반품 완료되거나
-- 관리자에 의해 취소되면, 이미 판매자에게 지급된 돈을 되돌릴 방법이 전혀
-- 없었다. SettlementAdjustment 가 그 회수 기록이고, Settlement.adjustmentAmount
-- 는 한 정산이 흡수한 회수 합계다. 자세한 계산/흡수 로직은
-- src/lib/server/payout.ts 의 createSettlementClawbackForOrder / confirmPayout.
--
-- 기존 행 영향:
--   - SettlementAdjustment 는 새 테이블이라 비어서 시작한다. 백필할 과거
--     데이터가 없다 — 지금까지 정산 후 회수는 아예 기록되지 않았으므로
--     (RETURN_COMPLETED_ON_ALREADY_SETTLED_ORDER 로그 한 줄뿐이었다)
--     "이미 있었어야 할 회수"를 소급 생성하지 않는다. 과거에 실제로 발생한
--     정산-후-반품/취소 건이 있다면 그건 이 마이그레이션이 다루는 범위가
--     아니라 별도의 운영 조치(수동 조정) 대상이다.
--   - Settlement.adjustmentAmount 는 NOT NULL DEFAULT 0 으로 추가한다. 이
--     기본값은 "안전한 임시값"이 아니라 기존 정산 행들의 실제 값 그대로다:
--     이 컬럼이 생기기 전에는 흡수할 클로백 자체가 없었으므로, 모든 기존
--     Settlement 행의 adjustmentAmount 는 정확히 0 이 맞다. 그래서 별도
--     UPDATE 백필이 필요 없다.

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "adjustmentAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SettlementAdjustment" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlementId" TEXT,

    CONSTRAINT "SettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAdjustment_orderId_key" ON "SettlementAdjustment"("orderId");

-- CreateIndex
CREATE INDEX "SettlementAdjustment_sellerId_settlementId_idx" ON "SettlementAdjustment"("sellerId", "settlementId");

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAdjustment" ADD CONSTRAINT "SettlementAdjustment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
