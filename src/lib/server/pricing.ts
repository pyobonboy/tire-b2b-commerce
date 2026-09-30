// Single source of truth for the shipping surcharge added on top of a
// listing's unit price at checkout.
//
// createBuyerOrders (orders.ts) and addCartItem (cart.ts) used to persist
// `item.extraShipping`/`data.extraShipping` straight from the request body.
// The product page today always sends 0, so there's no live exploit, but
// that field is otherwise entirely client-controlled — and it feeds
// Payment.amount (via /api/payments/toss/prepare, which sums
// order.unitPrice * order.quantity + order.extraShipping straight from the
// DB) as well as settlement.ts's extra-fee screen. A client that sent a
// non-zero value would have it charged and shown as if the server had
// decided it.
//
// There is no per-listing or per-seller shipping-surcharge column in the
// schema (and this task may not add one), so the only honest server-side
// answer today is "no such surcharge exists, so it's always 0". Centralizing
// that answer here — instead of trusting the client, and instead of
// recomputing it ad hoc at each call site — is what keeps the total shown to
// the buyer, Payment.amount, and settlement.ts's extra-fee screen from ever
// silently diverging from each other, and is the single, obvious place to
// wire in a real per-listing/seller surcharge source later (at which point
// this signature can grow a `listing`/`sellerId` parameter to look it up).
export function resolveExtraShipping(): number {
  return 0;
}

// ---------------------------------------------------------------------------
// Task 2 — 배송비 (Seller.shippingFee / Seller.freeShippingThreshold)
// ---------------------------------------------------------------------------
// Shipping is a per-seller-per-checkout charge, not a per-listing one: a cart
// with three items from the same seller is charged that seller's fee once,
// not three times. This function only decides WHAT one seller's fee is for
// one checkout, given that seller's own goods subtotal (sum of
// unitPrice * quantity across every item from that seller in this checkout,
// computed by the caller from DB listing prices — never from the client).
// It deliberately knows nothing about how many Order rows that seller ends
// up with; see createBuyerOrders (orders.ts) for how the single resolved
// value here gets mapped onto potentially many Order rows without
// multiplying it.
export interface SellerShippingPolicy {
  shippingFee: number;
  freeShippingThreshold: number | null;
}

export function resolveSellerShippingFee(
  policy: SellerShippingPolicy,
  sellerSubtotal: number,
): number {
  if (policy.freeShippingThreshold !== null && sellerSubtotal >= policy.freeShippingThreshold) {
    return 0;
  }
  return policy.shippingFee;
}
