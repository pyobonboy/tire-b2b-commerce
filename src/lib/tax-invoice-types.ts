// View types returned by src/lib/server/taxInvoice.ts. Same plain-interface
// convention as review-types.ts / inquiry-types.ts / return-types.ts.

export type TaxInvoiceStatusValue = "REQUESTED" | "ISSUED" | "REJECTED" | "CANCELED";

// The buyer's own request for one month — /mypage/tax keys these by
// periodMonth against the existing 월별 집계 rows (settlement-types.ts's
// TaxMonthEntry). supplyAmount/vat/totalAmount are snapshotted at request
// time (schema.prisma's comment on TaxInvoice) and may no longer match a
// freshly recomputed TaxMonthEntry for the same month if an order on it was
// cancelled/returned afterward — that's intentional, not a bug; see the
// report for why.
export interface TaxInvoiceView {
  id: string;
  periodMonth: string;
  supplyAmount: number;
  vat: number;
  totalAmount: number;
  status: TaxInvoiceStatusValue;
  externalId: string | null;
  issuedAt: string | null;
  rejectReason: string | null;
  requestedAt: string;
}

// Admin's queue (src/app/admin/tax-invoices) — adds who requested it.
export interface AdminTaxInvoiceView extends TaxInvoiceView {
  user: {
    businessName: string;
    ownerName: string;
    loginId: string;
  };
}
