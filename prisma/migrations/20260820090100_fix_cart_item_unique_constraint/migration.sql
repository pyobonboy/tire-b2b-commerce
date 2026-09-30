-- DropIndex
DROP INDEX "CartItem_userId_tireId_key";

-- Merge any rows that would collide under the new (userId, tireId, sellerCode, dot) key
-- before enforcing it, keeping the earliest row per group and summing quantities.
WITH ranked AS (
  SELECT
    id,
    "userId",
    "tireId",
    "sellerCode",
    "dot",
    "quantity",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "tireId", "sellerCode", "dot"
      ORDER BY id
    ) AS rn
  FROM "CartItem"
),
keepers AS (
  SELECT id, "userId", "tireId", "sellerCode", "dot" FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT id, "userId", "tireId", "sellerCode", "dot", "quantity" FROM ranked WHERE rn > 1
),
extra_quantity AS (
  SELECT k.id AS keep_id, SUM(d."quantity") AS extra_qty
  FROM dupes d
  JOIN keepers k
    ON k."userId" = d."userId"
   AND k."tireId" = d."tireId"
   AND k."sellerCode" = d."sellerCode"
   AND k."dot" = d."dot"
  GROUP BY k.id
)
UPDATE "CartItem" c
SET "quantity" = LEAST(c."quantity" + extra_quantity.extra_qty, 100000)
FROM extra_quantity
WHERE c.id = extra_quantity.keep_id;

DELETE FROM "CartItem"
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "userId", "tireId", "sellerCode", "dot"
        ORDER BY id
      ) AS rn
    FROM "CartItem"
  ) ranked
  WHERE rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_tireId_sellerCode_dot_key" ON "CartItem"("userId", "tireId", "sellerCode", "dot");
