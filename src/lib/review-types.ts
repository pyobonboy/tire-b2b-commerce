// View types returned by src/lib/server/review.ts and consumed by the
// review-writing flow (src/app/reviews/new) and the product detail page
// (src/app/products/[id]/page.tsx). Mirrors the plain-interface style of
// admin-types.ts / seller-types.ts rather than re-exporting Prisma's
// generated types, so the client bundle never depends on @prisma/client.

export interface ReviewView {
  id: string;
  orderId: string;
  sellerId: string;
  listingId: string;
  rating: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// One row in the "which of my orders can I review" picker shown at
// /reviews/new when it's opened without an ?orderId. Deliberately carries
// enough product/seller context to render a recognizable card without a
// second round trip.
export interface ReviewableOrderView {
  orderId: string;
  productId: string;
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

// Response of GET /api/reviews/order/[orderId] — everything /reviews/new
// needs to decide whether to render the write form, the edit form (review
// already present), or an "not eligible yet" message.
export interface ReviewOrderContext {
  eligible: boolean;
  order: ReviewableOrderView;
  review: ReviewView | null;
}

// Per-seller aggregate, keyed by the listingId shown on the product page
// (ProductView.sellers[].id) so the client never needs to know Seller.id —
// see getReviewOverviewForListings in review.ts for how sellerId is resolved
// from listingId server-side.
export interface ListingReviewSummary {
  sellerId: string;
  averageRating: number;
  reviewCount: number;
}

export interface ReviewListItem {
  id: string;
  sellerId: string;
  rating: number;
  content: string;
  createdAt: string;
  // Masked business name of the reviewing buyer — see maskBusinessName in
  // review.ts. Never the raw businessName: a review is visible to any
  // visitor of the product page, including the reviewer's competitors.
  buyerLabel: string;
}

// Response of GET /api/reviews/by-listing.
export interface ReviewOverview {
  summaryByListingId: Record<string, ListingReviewSummary>;
  recentReviews: ReviewListItem[];
}
