-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundRequiredAt" TIMESTAMP(3);
