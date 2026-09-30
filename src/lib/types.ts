export type Manufacturer =
  "금호" | "한국" | "넥센" | "미쉐린" | "피렐리" | "콘티넨탈" | "브리지스톤" | "굿이어" | "던롭";

export interface Tire {
  id: string;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  discountRate: number;
  price: number;
  tag: "EVENT" | "BEST" | null;
  stock: number;
}

export interface EventItem {
  id: string;
  title: string;
  bannerGradient: string;
  status: "ongoing" | "ended";
  period: string;
  description: string;
}

export interface Order {
  id: string;
  tireModel: string;
  status: "배송조회" | "입금후취소" | "배송준비" | "배송완료";
  orderedAt: string;
  price: number;
}

export interface Notice {
  id: string;
  title: string;
  date: string;
}

export interface User {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  role?: "BUYER" | "SELLER" | "ADMIN";
  sellerId?: string | null;
}

export interface Seller {
  id?: string;
  code: string;
  // 배송비 정책 — 실서버 응답에만 있고 목데이터(getSellersForTire)에는 없어 optional.
  shippingFee?: number;
  freeShippingThreshold?: number | null;
  // null 은 비로그인 요청에 서버가 실제로 숨긴 값이다(0 이 아니라 null —
  // src/lib/server/products.ts 의 toSeller 참고). 목데이터의 리터럴 number 는
  // number | null 에 그대로 대입 가능하므로 호환된다.
  discountRate: number | null;
  price: number | null;
  stock: number | null;
  minOrder: number | null;
  shippingNote: string;
  courier: string;
  images?: string[];
}

export interface TireSpec {
  loadIndex: string;
  speedIndex: string;
  ply: string;
  origin: string;
  season: string;
  productCode: string;
}

export interface FactoryTireGroup {
  id: string;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  spec: string;
  factoryPrice: number;
  rows: {
    dot: string;
    discountRate: number;
    price: number;
    stock: number;
  }[];
}

export interface CartItem {
  id: string;
  tireId: string;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  price: number;
  quantity: number;
  extraShipping: number;
  sellerCode: string;
  stock?: number;
  listingId?: string;
}

export interface FullOrder {
  id: string;
  orderNo: string | null;
  status: string;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  factoryPrice: number;
  unitPrice: number;
  quantity: number;
  extraShipping: number;
  total: number;
  sellerCode: string;
  orderedAt: string;
  listingId?: string;
  sellerId?: string;
  dot?: string;
  cancelReason?: string | null;
  shippingStatus?: string;
  shippingStatusLabel?: string;
  courier?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  // Task 2/3 — per-order shipping fee snapshot and shipping-address snapshot.
  // Nullable only for orders that predate these columns (see schema.prisma's
  // comment on Order.recipientName); every order created via /checkout
  // always has them, aside from addressDetail/deliveryNote which are
  // genuinely optional.
  shippingFee?: number;
  recipientName?: string | null;
  recipientPhone?: string | null;
  postalCode?: string | null;
  address?: string | null;
  addressDetail?: string | null;
  deliveryNote?: string | null;
  // 교환/반품 — null until the buyer files one (src/lib/server/returns.ts).
  // See /mypage/orders for how this drives the "교환/반품 신청" entry point.
  returnRequest?: {
    id: string;
    type: "EXCHANGE" | "RETURN";
    status: "REQUESTED" | "APPROVED" | "REJECTED" | "COMPLETED";
    rejectReason: string | null;
  } | null;
}

export interface WishSeller {
  id: string;
  type: string;
  code: string;
  location: string;
  intro: string;
  wishedAt: string;
}

export interface MyListing {
  id: string;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  price: number;
  stock: number;
  status: "작성중" | "승인대기" | "판매중" | "반려" | "품절" | "비노출";
  registeredAt: string;
}

export interface CatalogRow {
  id: string;
  detailId: string;
  detailDot: string | null;
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  spec: string;
  productCode: string;
  dot: string;
  // null 은 비로그인 요청에 서버가 실제로 숨긴 값이다(0 이 아니라 null —
  // src/lib/server/products.ts 의 toCatalogRows 참고). 목데이터의 리터럴
  // number 는 number | null 에 그대로 대입 가능하므로 호환된다.
  factoryPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  stock: number | null;
  discountRate: number | null;
  tag: "EVENT" | "BEST" | null;
  registeredOrder: number;
}

export interface GoodsItem {
  id: string;
  category: "세차용품" | "자동차용품" | "오일" | "공구" | "장비" | "휠 액세서리";
  brand: string;
  name: string;
  discountRate: number;
  originalPrice: number;
  price: number;
  freeShipping: boolean;
}

export interface OrderStatusCounts {
  입금대기: number;
  입금완료: number;
  주문확인: number;
  배송준비중: number;
  배송중: number;
  배송완료: number;
  구매확정: number;
}

export interface CancelStatusCounts {
  입금전취소: number;
  입금후취소: number;
  교환완료: number;
  반품완료: number;
  재고없음: number;
  상품미도착: number;
}
