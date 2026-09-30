// Shared client/server view types for 판매자 정산 (payout.ts). Mirrors the
// convention in admin-types.ts/seller-types.ts/settlement-types.ts: plain
// interfaces, every date pre-serialized to an ISO string so the client never
// touches a Prisma Date or Decimal directly.

export type PayoutStatus = "PENDING" | "CONFIRMED" | "PAID";

export interface PayoutPeriod {
  start: string;
  end: string;
}

// Live, not-yet-settled totals for a period — see payout.ts's summarizeOrders
// for exactly how these are derived (gross includes shipping, commission
// does not, net is always gross - commission by subtraction).
export interface PayoutAggregate {
  orderCount: number;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
}

// One confirmed/paid Settlement row, read back exactly as stored — once a
// settlement is confirmed these numbers are a snapshot, never recomputed.
export interface PayoutSettlementView {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  // Clawback (SettlementAdjustment) total this settlement absorbed — see
  // createSettlementClawbackForOrder/confirmPayout in payout.ts. Always <= 0.
  // Already folded into netAmount below; exposed separately so a settlement
  // screen can show a "정산 조정 -N원" line explaining why
  // grossAmount - commissionAmount != netAmount, rather than the numbers just
  // silently not adding up.
  adjustmentAmount: number;
  netAmount: number;
  status: PayoutStatus;
  memo: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminPayoutSettlementView extends PayoutSettlementView {
  seller: {
    id: string;
    code: string;
    businessName: string;
  };
}

export interface SellerPayoutView {
  commissionRate: number;
  period: PayoutPeriod;
  // This seller's not-yet-absorbed clawback backlog (SettlementAdjustment
  // rows with settlementId still null), NOT scoped to `period` — see
  // getSellerUnsettledSummary in payout.ts. Already folded into
  // unsettled.netAmount; exposed separately for the same reason
  // PayoutSettlementView.adjustmentAmount is.
  adjustmentAmount: number;
  unsettled: PayoutAggregate;
  settlements: PayoutSettlementView[];
}

export interface AdminUnsettledSellerRow extends PayoutAggregate {
  sellerId: string;
  sellerCode: string;
  businessName: string;
  commissionRate: number;
  // Same meaning as SellerPayoutView.adjustmentAmount, for this one seller.
  // A seller with a pending clawback but zero unsettled orders this period
  // still gets a row (orderCount 0, grossAmount 0, commissionAmount 0,
  // netAmount == adjustmentAmount) — see getAdminUnsettledBySeller.
  adjustmentAmount: number;
}

export interface AdminPayoutView {
  period: PayoutPeriod;
  unsettledBySeller: AdminUnsettledSellerRow[];
  settlements: AdminPayoutSettlementView[];
}
