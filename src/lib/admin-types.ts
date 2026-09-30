export type AdminSellerStatus = "PENDING" | "ACTIVE" | "SUSPENDED";

export type AdminBuyerStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";

export interface AdminBuyerView {
  id: string;
  status: AdminBuyerStatus;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedReason: string | null;
  suspendReason: string | null;
  user: {
    id: string;
    loginId: string;
    businessName: string;
    businessRegNumber: string;
    ownerName: string;
    email: string | null;
    mobilePhone: string;
    officePhone: string | null;
    postalCode: string | null;
    address: string | null;
    createdAt: string;
  };
}

export interface AdminSellerView {
  id: string;
  code: string;
  status: AdminSellerStatus;
  courier: string;
  shippingNote: string | null;
  location: string | null;
  intro: string | null;
  approvedAt: string | null;
  suspendReason: string | null;
  user: {
    id: string;
    loginId: string;
    businessName: string;
    businessRegNumber: string;
    ownerName: string;
    email: string | null;
    mobilePhone: string;
    officePhone: string | null;
    postalCode: string | null;
    address: string | null;
    createdAt: string;
  };
  listingCount: number;
}

export type AdminListingStatus =
  | "DRAFT"
  | "PENDING"
  | "ACTIVE"
  | "REJECTED"
  | "SOLDOUT"
  | "HIDDEN";

export interface AdminListingView {
  id: string;
  status: AdminListingStatus;
  rejectedReason: string | null;
  manufacturer: string;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  loadIndex: string;
  speedIndex: string;
  ply: string;
  oe: string | null;
  season: string;
  productCode: string;
  discountRate: number;
  price: number;
  factoryPrice: number;
  stock: number;
  minOrder: number;
  tag: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  seller: {
    id: string;
    code: string;
    status: AdminSellerStatus;
    businessName: string;
    ownerName: string;
  };
}

export type AdminShippingStatus = "PREPARING" | "TRACKING_REGISTERED" | "SHIPPED" | "DELIVERED";

// Same shape as (and mirrors) src/lib/seller-types.ts's OrderShippingView —
// see resolveOrderShipping in src/lib/server/admin.ts for the fallback rule.
export interface AdminOrderShippingView {
  recipientName: string;
  recipientPhone: string;
  postalCode: string | null;
  address: string | null;
  addressDetail: string | null;
  deliveryNote: string | null;
}

export interface AdminOrderView {
  id: string;
  orderNo: string | null;
  listingId: string;
  sellerId: string;
  status: string;
  shippingStatus: AdminShippingStatus;
  courier: string | null;
  trackingNumber: string | null;
  quantity: number;
  unitPrice: number;
  extraShipping: number;
  shippingFee: number;
  total: number;
  orderedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  product: {
    manufacturer: string;
    model: string;
    width: number;
    ratio: number;
    rim: number;
    dot: string;
    sellerCode: string;
  };
  seller: {
    id: string;
    code: string;
    businessName: string;
  };
  buyer: {
    businessName: string;
    ownerName: string;
    mobilePhone: string;
    officePhone: string | null;
  };
  shipping: AdminOrderShippingView;
  payment: {
    id: string;
    status: "READY" | "DONE" | "FAILED" | "CANCELED";
    refundRequiredAt: string | null;
    refundReason: string | null;
    refundAmount: number;
  } | null;
}
