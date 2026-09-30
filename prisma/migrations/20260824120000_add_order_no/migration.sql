-- 사람이 읽는 주문번호. 지금까지 화면의 "주문번호"는 내부 cuid 를 그대로
-- 내보낸 것이라(cmt6kgb1p000f...), 전화 CS 에서 불러줄 수도, 계산서에 적을
-- 수도 없었다.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderNo" TEXT;

-- Backfill: 기존 주문 전부에 KST 날짜 + 당일 순번을 부여한다. 순번 기준은
-- (주문시각, id) 정렬 — 같은 초에 들어온 주문도 결정적으로 갈린다. 날짜를
-- KST 로 자르는 이유는 앱의 생성 로직과 같은 달력을 써야 하기 때문:
-- UTC 로 자르면 한국 새벽 주문이 전날 번호를 받아, 백필분과 신규분이
-- 같은 날짜에 다른 규칙을 쓰게 된다.
UPDATE "Order" o
SET "orderNo" = s.no
FROM (
  SELECT id,
         to_char("orderedAt" AT TIME ZONE 'Asia/Seoul', 'YYYYMMDD') || '-' ||
         lpad((row_number() OVER (
           PARTITION BY (("orderedAt" AT TIME ZONE 'Asia/Seoul')::date)
           ORDER BY "orderedAt", id
         ))::text, 4, '0') AS no
  FROM "Order"
) s
WHERE s.id = o.id;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");
