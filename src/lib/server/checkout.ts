// ---------------------------------------------------------------------------
// Task 3 — 주문서 (체크아웃) preview
// ---------------------------------------------------------------------------
// Read-only support for the /checkout page: given the buyer's current cart,
// group it by seller and resolve each seller's shipping fee, so the page can
// show 상품금액 / 배송비 / 합계 *before* the buyer commits to creating any
// orders. This deliberately reuses the exact same pieces createBuyerOrders
// (orders.ts) uses for the real thing — resolveSellerShippingFee (pricing.ts)
// and the sellerInGoodStanding filter (orders.ts) — so the preview shown here
// and the amount actually charged at order-creation time can never disagree
// about the *rule*, even though the preview is necessarily a snapshot that
// can go stale if the cart or a seller's policy changes before the buyer
// clicks the final button. createBuyerOrders re-resolves everything fresh
// regardless of what this returned, which is what makes that staleness safe.
import { prisma } from "./prisma";
import { getCartItems } from "./cart";
import { sellerInGoodStanding } from "./orders";
import { resolveSellerShippingFee } from "./pricing";

export interface CheckoutSellerGroup {
  sellerCode: string;
  // Sum of price * quantity + extraShipping across every cart line for this
  // seller — the same "goods total" figure the cart page already shows per
  // line, just grouped. Not necessarily identical to what createBuyerOrders
  // will charge (that re-reads each listing's live price), but close enough
  // for a pre-submit preview, exactly like the cart page's own total already
  // is today.
  subtotal: number;
  shippingFee: number;
}

export async function getCheckoutShippingSummary(userId: string): Promise<CheckoutSellerGroup[]> {
  const items = await getCartItems(userId);

  const subtotalsByCode = new Map<string, number>();
  for (const item of items) {
    const lineTotal = item.price * item.quantity + item.extraShipping;
    subtotalsByCode.set(item.sellerCode, (subtotalsByCode.get(item.sellerCode) ?? 0) + lineTotal);
  }
  const sellerCodes = Array.from(subtotalsByCode.keys());
  if (sellerCodes.length === 0) return [];

  const sellers = await prisma.seller.findMany({
    where: { code: { in: sellerCodes }, ...sellerInGoodStanding },
    select: { code: true, shippingFee: true, freeShippingThreshold: true },
  });
  const sellerByCode = new Map(sellers.map((seller) => [seller.code, seller] as const));

  return sellerCodes.map((sellerCode) => {
    const subtotal = subtotalsByCode.get(sellerCode) ?? 0;
    const policy = sellerByCode.get(sellerCode);
    // A seller that dropped out of good standing (suspended, withdrawn)
    // between add-to-cart and checkout has no policy to look up here. There
    // is nothing sane to preview for a seller that's about to be rejected
    // outright by findActiveListing when the buyer actually submits, so this
    // just shows 0 rather than guessing — the real error surfaces at
    // submission time via ORDER_ITEM_NOT_FOUND, same as it always has.
    const shippingFee = policy ? resolveSellerShippingFee(policy, subtotal) : 0;
    return { sellerCode, subtotal, shippingFee };
  });
}
