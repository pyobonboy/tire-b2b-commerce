import { NextResponse } from "next/server";
import { InquiryStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import type { AdminInquiryView, InquiryView } from "@/lib/inquiry-types";
import { prisma } from "./prisma";
import { notifyUser } from "./notify";

// ---------------------------------------------------------------------------
// 1:1 문의 / 상품 문의
// ---------------------------------------------------------------------------
// listingId present -> 상품 문의 (product question), absent -> general 1:1
// inquiry (see the Inquiry model's schema comment). Both are the same table
// and the same privacy rule: an inquiry is visible only to the user who
// asked it and to admins — this module never exposes one user's inquiry to
// another user, including other product questions asked by other buyers
// about the same listing. (A public product-Q&A board, where an answered
// question is visible to every shopper, is a different feature this task
// did not ask for — see the report for why that reading was chosen.)

// category is a free string in the schema (not a DB enum), matching how
// FAQ_CATEGORIES in mockData.ts is just a UI grouping, not a closed set the
// server enforces. The product-question flow on the product detail page
// sends the fixed value "product" (not one of FAQ_CATEGORIES, since none of
// those fit "question about this exact listing"); the general 1:1 tab keeps
// sending one of FAQ_CATEGORIES' ids as before.
export const createInquirySchema = z.object({
  category: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(4000),
  listingId: z.string().trim().min(1).max(64).optional(),
});

export const answerInquirySchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});

export class InquiryDomainError extends Error {
  constructor(
    public readonly code: "LISTING_NOT_FOUND" | "INQUIRY_NOT_FOUND",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "InquiryDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof InquiryDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function toInquiryView(inquiry: Prisma.InquiryGetPayload<object>): InquiryView {
  return {
    id: inquiry.id,
    listingId: inquiry.listingId,
    category: inquiry.category,
    title: inquiry.title,
    content: inquiry.content,
    status: inquiry.status,
    answer: inquiry.answer,
    answeredAt: inquiry.answeredAt?.toISOString() ?? null,
    createdAt: inquiry.createdAt.toISOString(),
  };
}

const adminInquiryInclude = {
  user: { select: { businessName: true, ownerName: true, loginId: true } },
} satisfies Prisma.InquiryInclude;

type AdminInquiryRecord = Prisma.InquiryGetPayload<{ include: typeof adminInquiryInclude }>;

function toAdminInquiryView(inquiry: AdminInquiryRecord, listingLabel: string | null): AdminInquiryView {
  return {
    ...toInquiryView(inquiry),
    user: inquiry.user,
    listingLabel,
  };
}

/**
 * listingId -> "제조사 모델 · 판매자코드" for the admin queue, so a human
 * triaging inquiries isn't staring at a bare cuid. Inquiry.listingId is a
 * plain scalar column (no Prisma relation — see the schema comment), so this
 * is a second, bounded query rather than a `select`-time join: bounded
 * because it only ever looks up the distinct listingIds actually present on
 * the page of inquiries just fetched, never "every listing".
 */
async function buildListingLabels(listingIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(listingIds.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return new Map();

  const listings = await prisma.listing.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, product: { select: { manufacturer: true, model: true } }, seller: { select: { code: true } } },
  });
  return new Map(
    listings.map((listing) => [listing.id, `${listing.product.manufacturer} ${listing.product.model} · ${listing.seller.code}`] as const),
  );
}

/**
 * Create an inquiry for `userId`. userId is always the session's own id
 * (enforced by the route, never taken from the request body), so ownership
 * is correct by construction — there is no "on behalf of another user" path.
 */
export async function createInquiry(userId: string, data: z.infer<typeof createInquirySchema>): Promise<InquiryView> {
  if (data.listingId) {
    const listing = await prisma.listing.findUnique({ where: { id: data.listingId }, select: { id: true } });
    if (!listing) throw new InquiryDomainError("LISTING_NOT_FOUND", 404);
  }

  const created = await prisma.inquiry.create({
    data: {
      userId,
      listingId: data.listingId ?? null,
      category: data.category,
      title: data.title,
      content: data.content,
    },
  });
  return toInquiryView(created);
}

/**
 * The signed-in user's own inquiries, optionally narrowed to a set of
 * listingIds (used by the product detail page for "내 상품 문의"). Every
 * query here is scoped by `userId: userId` from the session — this is the
 * entire mechanism that keeps one user from ever reading another's inquiry;
 * there is no separate "is this mine" check layered on top because there is
 * no code path that fetches an inquiry without this filter already applied.
 */
export async function getMyInquiries(userId: string, listingIds?: readonly string[]): Promise<InquiryView[]> {
  const inquiries = await prisma.inquiry.findMany({
    where: {
      userId,
      ...(listingIds && listingIds.length > 0 ? { listingId: { in: [...listingIds] } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return inquiries.map(toInquiryView);
}

/** Admin-only: every inquiry, optionally filtered by status. */
export async function getAdminInquiries(status?: string): Promise<AdminInquiryView[]> {
  const validStatus = status && Object.values(InquiryStatus).includes(status as InquiryStatus) ? (status as InquiryStatus) : undefined;
  const inquiries = await prisma.inquiry.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    // Unanswered first (OPEN, then ANSWERED, then CLOSED alphabetically
    // happens to match that priority), newest-first within each group — same
    // "surface what needs attention first" idea as getAdminListings' status
    // priority sort in admin.ts, just expressible directly as an orderBy
    // here since OPEN < ANSWERED < CLOSED alphabetically already.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: adminInquiryInclude,
  });

  const labels = await buildListingLabels(inquiries.map((inquiry) => inquiry.listingId));
  return inquiries.map((inquiry) => toAdminInquiryView(inquiry, labels.get(inquiry.listingId ?? "") ?? null));
}

/**
 * Admin answers (or re-answers, e.g. to fix a typo) an inquiry: sets answer/
 * answeredAt/answeredBy and moves status to ANSWERED, logs an AdminActionLog
 * entry the same way admin.ts's review/approve/suspend actions do, and
 * notifies the asking user once the transaction has committed (never from
 * inside it — see notify.ts's file header for why).
 *
 * NOTE: InquiryStatus also has a CLOSED value, but nothing in this task sets
 * it — there is no "close without answering" or "reopen" admin action in
 * scope here, only answer. Same kind of documented gap as ReturnRequest's
 * COMPLETED status in schema.prisma ("정의만 되어 있고 지금까지 아무도
 * 세팅하지 않았다"): CLOSED is reachable only by a future feature, not by
 * anything in this module.
 */
export async function answerInquiry(
  inquiryId: string,
  adminId: string,
  data: z.infer<typeof answerInquirySchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const inquiry = await tx.inquiry.findUnique({ where: { id: inquiryId } });
    if (!inquiry) return { kind: "NOT_FOUND" as const };

    const updated = await tx.inquiry.update({
      where: { id: inquiryId },
      data: {
        answer: data.answer,
        answeredAt: new Date(),
        answeredBy: adminId,
        status: "ANSWERED",
      },
      include: adminInquiryInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "INQUIRY_ANSWER",
        targetType: "Inquiry",
        targetId: inquiryId,
      },
    });
    return { kind: "OK" as const, record: updated };
  });

  if (result.kind === "NOT_FOUND") return result;

  const labels = await buildListingLabels([result.record.listingId]);
  const inquiry = toAdminInquiryView(result.record, labels.get(result.record.listingId ?? "") ?? null);

  await notifyUser(result.record.userId, "INQUIRY_ANSWERED", {
    subject: "문의하신 내용에 답변이 등록되었습니다",
    body: `등록하신 문의(${inquiry.title})에 답변이 등록되었습니다. 로그인 후 확인해 주세요.`,
  });

  return { kind: "OK" as const, inquiry };
}
