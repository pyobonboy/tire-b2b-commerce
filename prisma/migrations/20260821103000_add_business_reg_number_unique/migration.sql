-- 사업자등록번호 uniqueness (see businessRegNumber.ts and src/lib/server/account.ts's
-- withdrawAccount for the full design). Existing rows need two kinds of
-- cleanup before a UNIQUE index can be added, or it would simply fail to
-- apply against real data:
--
-- 1. Normalise formatting. Signup previously stored whatever the applicant
--    typed verbatim (hyphens, spaces, or neither), so "123-45-67890" and
--    "1234567890" could already both exist as the *same* real business
--    registered twice in different formats. Strip everything but digits so
--    every row uses the one canonical form going forward — this must run
--    BEFORE the de-duplication step below, otherwise that step would miss
--    pairs that only match after normalising.
--
-- 2. Collapse genuine duplicates. Rows that legitimately share one real
--    registration number (the exact bug this migration exists to close) can't
--    all keep it once it's unique. We keep the oldest account's number as-is
--    (arbitrary but stable tie-break) and rewrite every newer duplicate to a
--    tombstone of the form "WITHDRAWN#<id>" — the same format
--    src/lib/server/account.ts's withdrawAccount uses going forward. It can
--    never collide with a real checksum-valid 10-digit number (which is
--    all-digits) or with another row's tombstone (each is suffixed with that
--    row's own unique id). This does not un-suspend or otherwise change the
--    account itself; an admin should still follow up on any account
--    tombstoned here, since it means two signups shared one 사업자등록번호.
UPDATE "User"
SET "businessRegNumber" = regexp_replace("businessRegNumber", '[^0-9]', '', 'g');

WITH ranked AS (
  SELECT "id", "businessRegNumber",
         ROW_NUMBER() OVER (
           PARTITION BY "businessRegNumber"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "User"
)
UPDATE "User" u
SET "businessRegNumber" = 'WITHDRAWN#' || u."id"
FROM ranked r
WHERE u."id" = r."id" AND r.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "User_businessRegNumber_key" ON "User"("businessRegNumber");

-- Record every row the de-duplication above rewrote, so the change is
-- discoverable. This is not cosmetic: an account tombstoned here is NOT
-- withdrawn — it still logs in, orders and sells normally, it just no longer
-- carries a real 사업자등록번호. Without a durable record, that silent
-- mutation of a live business's registration number would be invisible to
-- operators, who need to contact both businesses and work out which one is
-- entitled to the number. AdminActionLog is the existing audit surface
-- (see the adminActionLog.create calls in src/lib/server/admin.ts), so the
-- rows land where an operator already looks.
INSERT INTO "AdminActionLog"("id","adminId","action","targetType","targetId","reason")
SELECT
  'migr_' || u."id",
  'SYSTEM_MIGRATION',
  'BUSINESS_REG_NUMBER_TOMBSTONED',
  'User',
  u."id",
  '중복 사업자등록번호로 인해 마이그레이션이 값을 톰스톤 처리했습니다. 계정은 정상 활성 상태이므로 실제 사업자등록번호를 확인해 복구해야 합니다.'
FROM "User" u
WHERE u."businessRegNumber" = 'WITHDRAWN#' || u."id"
  AND u."withdrawnAt" IS NULL;
