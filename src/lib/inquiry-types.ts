// View types returned by src/lib/server/inquiry.ts. Same plain-interface
// convention as admin-types.ts — no @prisma/client types leak to the client.

export type InquiryStatusValue = "OPEN" | "ANSWERED" | "CLOSED";

// A user's own inquiry (src/app/customer/page.tsx's 1:1 문의 tab, and the
// "내 상품 문의" block on the product detail page). listingId is present iff
// this is a product question — see the Inquiry model's schema comment.
export interface InquiryView {
  id: string;
  listingId: string | null;
  category: string;
  title: string;
  content: string;
  status: InquiryStatusValue;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

// Admin's view of every inquiry (src/app/admin/inquiries). Adds who asked
// and, for product questions, a human-readable label for the listingId
// (a raw cuid is useless to a person triaging the queue).
export interface AdminInquiryView extends InquiryView {
  user: {
    businessName: string;
    ownerName: string;
    loginId: string;
  };
  listingLabel: string | null;
}
