// Client-safe mirror of ShippingAddressView (src/lib/server/shippingAddress.ts).
// Shared by the 배송지 관리 screen (src/app/mypage/addresses/page.tsx) and the
// checkout address picker (src/app/checkout/page.tsx) — both read the same
// saved-address list shape.
export interface ShippingAddressView {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  address: string;
  addressDetail: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
