// View types returned by src/lib/server/returns.ts. Same plain-interface,
// no-@prisma/client-on-the-client convention as review-types.ts /
// inquiry-types.ts.

export type ReturnRequestType = "EXCHANGE" | "RETURN";
export type ReturnRequestStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED";

// The buyer's own request — /mypage/returns and /mypage/returns/new.
export interface ReturnRequestView {
  id: string;
  orderId: string;
  type: ReturnRequestType;
  reason: string;
  detail: string | null;
  status: ReturnRequestStatus;
  rejectReason: string | null;
  requestedAt: string;
  processedAt: string | null;
}

// One row in the "which of my delivered orders can I request an
// exchange/return for" picker shown at /mypage/returns/new when opened
// without an ?orderId — mirrors ReviewableOrderView (review-types.ts)
// exactly, same reasoning: enough product/seller context to render a
// recognizable card without a second round trip.
export interface ReturnEligibleOrderView {
  orderId: string;
  manufacturer: string;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  sellerCode: string;
  unitPrice: number;
  quantity: number;
  orderedAt: string;
}

// Response of GET /api/returns/order/[orderId] — everything
// /mypage/returns/new needs to decide whether to render the request form, an
// existing request's status, or an "not eligible" message.
export interface ReturnRequestOrderContext {
  eligible: boolean;
  order: ReturnEligibleOrderView;
  returnRequest: ReturnRequestView | null;
}

// Order/product context every processing-queue row (seller + admin) needs,
// on top of the request itself — mirrors SellerOrderView's product shape
// (seller-types.ts).
export interface ReturnRequestOrderSummary {
  // 사람이 읽는 주문번호. 컬럼 이전 주문은 null 이라 화면에서 orderId 로 폴백.
  orderNo: string | null;
  manufacturer: string;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  unitPrice: number;
  quantity: number;
  total: number;
  orderedAt: string;
}

// The buyer's own list — /mypage/returns. Same order context as the
// processing-queue views below, so the buyer can tell which tire/order each
// row is about without a second round trip per row.
export interface BuyerReturnRequestView extends ReturnRequestView {
  order: ReturnRequestOrderSummary;
  sellerCode: string;
}

export interface SellerReturnRequestView extends ReturnRequestView {
  order: ReturnRequestOrderSummary;
  buyer: {
    businessName: string;
    ownerName: string;
    mobilePhone: string;
  };
}

// Admin sees every seller's queue, so it additionally carries who the
// seller is (sellerId has no Prisma relation on ReturnRequest — see the
// schema comment — so this is resolved server-side the same way
// buildListingLabels resolves Inquiry.listingId in inquiry.ts).
export interface AdminReturnRequestView extends SellerReturnRequestView {
  seller: {
    id: string;
    code: string;
    businessName: string;
  };
}
