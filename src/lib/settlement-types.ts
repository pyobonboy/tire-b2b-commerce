// Shared client/server view types for the buyer's real financial history
// screens (입출금 내역 / 세금계산서 내역 / 추가비용 내역). Mirrors the
// AccountProfile convention in account-types.ts: one plain interface per
// view, all dates pre-serialized to ISO strings so the client never touches
// a Prisma Date directly.

// "-" (no refund happened at all), "COMPLETED" (Toss actually returned the
// money), or "PENDING" (a refund is owed but has not been executed yet —
// either a partial cancellation, which this app always routes to manual
// admin processing, or a full-cancel Toss call that failed). See
// src/lib/server/settlement.ts for exactly how this is derived from
// Payment.status/refundRequiredAt/refundReason.
// PARTIAL exists because "이 결제가 통째로 환불됐다"와 "이 결제에서 일부 주문만
// 환불됐고 그 환불은 실제로 끝났다"는 서로 다른 사실이고, 둘 다 "아직 처리 중"과도
// 다르다. 셋을 구분하지 않으면 둘 중 하나는 반드시 거짓말이 된다 — 부분환불을
// COMPLETED로 뭉뚱그리면 전액 돌려받은 것처럼 읽히고, PENDING으로 뭉뚱그리면 이미
// 돈이 돌아간 손님에게 영원히 "처리 중"이라고 표시된다.
export type DepositRefundStatus = "NONE" | "COMPLETED" | "PARTIAL" | "PENDING";

export interface DepositEntry {
  paymentId: string;
  tossOrderId: string;
  // 사람이 읽는 주문번호들(20260825-0003). 결제 1건이 주문 여러 개를 묶으므로
  // 배열. 화면은 이 값을 "통합주문번호"로 보여주고, 컬럼 이전 주문(비어 있음)만
  // tossOrderId 로 폴백한다.
  orderNos: string[];
  itemLabel: string;
  paidAmount: number;
  refundAmount: number;
  refundStatus: DepositRefundStatus;
  refundStatusLabel: string;
  date: string;
}

export interface TaxMonthEntry {
  month: string;
  supplyAmount: number;
  vat: number;
  total: number;
}

export interface ExtraFeeEntry {
  orderId: string;
  // 사람이 읽는 주문번호(20260825-0003). 화면 "주문번호" 컬럼에 내부 cuid 대신
  // 이 값을 쓰고, 컬럼 이전 주문만 null 이라 그때는 orderId 로 폴백한다.
  orderNo: string | null;
  itemLabel: string;
  extraShipping: number;
  orderedAt: string;
}

export interface SettlementView {
  // "BUYER": the real, per-user data below is populated. "NOT_APPLICABLE":
  // this session's role never has Payment/Order-as-buyer rows by
  // construction (see getSettlementView), so the arrays are intentionally
  // empty and scopeMessage explains why — the UI must show that message
  // instead of an empty table that could be mistaken for a loading bug.
  scope: "BUYER" | "NOT_APPLICABLE";
  scopeMessage: string | null;
  deposits: DepositEntry[];
  depositsTotal: number;
  taxYears: string[];
  taxByYear: Record<string, TaxMonthEntry[]>;
  extraFees: ExtraFeeEntry[];
  extraFeesTotal: number;
}
