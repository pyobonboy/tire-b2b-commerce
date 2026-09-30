-- AlterTable
--
-- Nullable with no backfill, deliberately. A NULL means "the password has not
-- changed since this column existed", so getSession() invalidates nothing for
-- rows that predate it. Backfilling a timestamp here would instead sign every
-- existing user out at deploy time for no security benefit — no password
-- actually changed.
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);
