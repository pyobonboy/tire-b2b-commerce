-- 쇼핑몰로서 빠져 있던 기능들의 스키마. 전부 추가만 하며 기존 컬럼은 건드리지 않는다.

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID');
CREATE TYPE "InquiryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');
CREATE TYPE "ReturnType" AS ENUM ('EXCHANGE', 'RETURN');
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED');
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('REQUESTED', 'ISSUED', 'REJECTED', 'CANCELED');

-- AlterTable: Seller — 배송비 정책 + 수수료율
ALTER TABLE "Seller" ADD COLUMN     "shippingFee" INTEGER NOT NULL DEFAULT 0,
                     ADD COLUMN     "freeShippingThreshold" INTEGER,
                     ADD COLUMN     "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable: Order — 배송지 스냅샷 + 배송비 + 정산 연결
ALTER TABLE "Order" ADD COLUMN     "recipientName" TEXT,
                    ADD COLUMN     "recipientPhone" TEXT,
                    ADD COLUMN     "postalCode" TEXT,
                    ADD COLUMN     "address" TEXT,
                    ADD COLUMN     "addressDetail" TEXT,
                    ADD COLUMN     "deliveryNote" TEXT,
                    ADD COLUMN     "shippingFee" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN     "settlementId" TEXT;

-- Backfill: 기존 주문의 배송지.
--
-- 이 컬럼이 생기기 전에는 판매자가 주문 화면에서 구매자의 User 레코드를 직접
-- 읽어 배송지로 썼다(sellerOrderInclude 의 postalCode/address/ownerName/
-- mobilePhone). 그러니 기존 주문의 "실제 배송지"는 지금 그 User 값이 맞다.
-- 백필하지 않으면 새 화면에서 과거 주문의 배송지가 통째로 비어 보인다.
--
-- User.postalCode/address 자체가 NULL 인 계정도 있어 결과가 NULL 로 남을 수
-- 있는데, 그건 원래 주소가 없었다는 사실을 그대로 옮기는 것이라 맞다.
UPDATE "Order" o
SET "recipientName"  = u."ownerName",
    "recipientPhone" = u."mobilePhone",
    "postalCode"     = u."postalCode",
    "address"        = u."address"
FROM "User" u
WHERE u."id" = o."buyerId";

-- CreateTable
CREATE TABLE "ShippingAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressDetail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossAmount" INTEGER NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "memo" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "rejectReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "supplyAmount" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "status" "TaxInvoiceStatus" NOT NULL DEFAULT 'REQUESTED',
    "externalId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "rejectReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShippingAddress_userId_idx" ON "ShippingAddress"("userId");
CREATE INDEX "Settlement_sellerId_status_idx" ON "Settlement"("sellerId", "status");
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");
CREATE INDEX "Review_sellerId_idx" ON "Review"("sellerId");
CREATE INDEX "Review_listingId_idx" ON "Review"("listingId");
CREATE INDEX "Inquiry_userId_idx" ON "Inquiry"("userId");
CREATE INDEX "Inquiry_status_idx" ON "Inquiry"("status");
CREATE INDEX "Inquiry_listingId_idx" ON "Inquiry"("listingId");
CREATE UNIQUE INDEX "ReturnRequest_orderId_key" ON "ReturnRequest"("orderId");
CREATE INDEX "ReturnRequest_buyerId_idx" ON "ReturnRequest"("buyerId");
CREATE INDEX "ReturnRequest_sellerId_status_idx" ON "ReturnRequest"("sellerId", "status");
CREATE UNIQUE INDEX "TaxInvoice_userId_periodMonth_key" ON "TaxInvoice"("userId", "periodMonth");
CREATE INDEX "TaxInvoice_status_idx" ON "TaxInvoice"("status");
CREATE INDEX "Order_settlementId_idx" ON "Order"("settlementId");

-- AddForeignKey
ALTER TABLE "ShippingAddress" ADD CONSTRAINT "ShippingAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
