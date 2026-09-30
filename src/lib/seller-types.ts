export type SellerListingStatus =
  | "DRAFT"
  | "PENDING"
  | "ACTIVE"
  | "REJECTED"
  | "SOLDOUT"
  | "HIDDEN";

export interface SellerListingView {
  id: string;
  status: SellerListingStatus;
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
  createdAt: string;
  updatedAt: string;
  seller: {
    id: string;
    code: string;
    courier: string;
    shippingNote: string | null;
    location: string | null;
    intro: string | null;
    shippingFee: number;
    freeShippingThreshold: number | null;
  };
  images: { id: string; url: string; sortOrder: number }[];
}

export type SellerShippingStatus =
  | "PREPARING"
  | "TRACKING_REGISTERED"
  | "SHIPPED"
  | "DELIVERED";

// Snapshot address for one order — the order's own recipient/address fields,
// already resolved against the live buyer record for any field that's still
// null on a pre-migration order (see resolveOrderShipping in
// src/lib/server/seller.ts). postalCode/address stay nullable because that
// fallback can itself be null (a buyer whose profile address was empty);
// recipientName/recipientPhone never actually are, but are left non-nullable
// here since the fallback source (User.ownerName/mobilePhone) is NOT NULL.
export interface OrderShippingView {
  recipientName: string;
  recipientPhone: string;
  postalCode: string | null;
  address: string | null;
  addressDetail: string | null;
  deliveryNote: string | null;
}

export interface SellerOrderView {
  id: string;
  orderNo: string | null;
  listingId: string;
  sellerId: string;
  status: string;
  shippingStatus: SellerShippingStatus;
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
  buyer: {
    businessName: string;
    ownerName: string;
    mobilePhone: string;
    officePhone: string | null;
  };
  shipping: OrderShippingView;
}
