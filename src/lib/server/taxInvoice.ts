import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AdminTaxInvoiceView, TaxInvoiceView } from "@/lib/tax-invoice-types";
import { kstMonthString } from "./kst";
import { prisma } from "./prisma";
import { notifyUser } from "./notify";
import { getBuyerMonthPaidTotal } from "./settlement";

// ---------------------------------------------------------------------------
// 세금계산서
// ---------------------------------------------------------------------------
// No 국세청/팝빌 integration exists (schema.prisma's comment on TaxInvoice) —
// this module only ever covers 신청 접수 -> 관리자가 외부에서 발행 -> 결과
// 기록. Amounts are snapshotted at request time from the exact same
// computation /mypage/tax's aggregate already uses (getBuyerMonthPaidTotal,
// settlement.ts) — never a second formula — specifically so a later
// cancellation/return can't silently change an invoice that was already
// requested or issued, per the schema's own comment on TaxInvoice.

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Same "YYYY-MM" derivation getBuyerPaidOrderMonthlyAmounts (settlement.ts)
// uses (kstMonthString, src/lib/server/kst.ts) — i.e. KST calendar month, not
// a UTC one. Using a different convention here would make "is this month
// over yet" disagree by a few hours around midnight KST with how months are
// actually bucketed everywhere else this app computes them (payout.ts's
// settlement periods included — see kst.ts's header).
function currentMonthString(now: Date = new Date()): string {
  return kstMonthString(now);
}

export const requestTaxInvoiceSchema = z.object({
  periodMonth: z.string().regex(PERIOD_MONTH_RE, "YYYY-MM 형식이어야 합니다."),
});

export const issueTaxInvoiceSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
});

export const rejectTaxInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export class TaxInvoiceDomainError extends Error {
  constructor(
    public readonly code: "PERIOD_NOT_ELAPSED" | "NO_PAID_ORDERS" | "ALREADY_REQUESTED_OR_ISSUED",
    public readonly status = 409,
  ) {
    super(code);
    this.name = "TaxInvoiceDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json({ error: "VALIDATION_ERROR", details: error.issues }, { status: 400 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof TaxInvoiceDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function toTaxInvoiceView(record: Prisma.TaxInvoiceGetPayload<object>): TaxInvoiceView {
  return {
    id: record.id,
    periodMonth: record.periodMonth,
    supplyAmount: record.supplyAmount,
    vat: record.vat,
    totalAmount: record.totalAmount,
    status: record.status,
    externalId: record.externalId,
    issuedAt: record.issuedAt?.toISOString() ?? null,
    rejectReason: record.rejectReason,
    requestedAt: record.requestedAt.toISOString(),
  };
}

/**
 * Request (or re-request) a tax invoice for `periodMonth`. Three refusals,
 * all clear Korean-mapped domain errors rather than a raw 500 or a bare
 * unique-constraint 500:
 *
 *   - the month hasn't fully elapsed yet (including the current month — see
 *     below for why that's refused outright rather than merely producing an
 *     incomplete snapshot)
 *   - no paid orders exist for that month at all
 *   - @@unique([userId, periodMonth]) already holds a REQUESTED or ISSUED
 *     row for this exact month
 *
 * WHY THE CURRENT MONTH IS NEVER REQUESTABLE: amounts are frozen at request
 * time (by design — see the module header), and the current month is still
 * actively accumulating paid orders. A snapshot taken mid-month would
 * permanently understate that month's real total the moment one more order
 * gets paid before the month ends, with no way to correct it short of a
 * human noticing and rejecting/reissuing. Refusing it outright is strictly
 * safer than letting a buyer request early and hoping they don't.
 *
 * RETRY AFTER REJECTION: @@unique([userId, periodMonth]) means a second row
 * for the same month can never be inserted, so a REJECTED (or, if a future
 * feature ever produces one, CANCELED — see the schema comment on
 * TaxInvoiceStatus; nothing in this module sets it today) row is reopened in
 * place instead: the snapshot is recomputed fresh (safe, because a fully
 * elapsed month's set of paid orders is effectively immutable going forward
 * — payment.approvedAt never changes after the fact — except that a *later*
 * return/cancellation on one of those orders can still lower it, which is
 * exactly the right behaviour for a request that was never issued) and every
 * trace of the previous admin decision (rejectReason/externalId/issuedAt/
 * issuedBy) is cleared. A REQUESTED or already-ISSUED row is never silently
 * reopened this way — see ALREADY_REQUESTED_OR_ISSUED above.
 */
export async function requestTaxInvoice(userId: string, periodMonth: string): Promise<TaxInvoiceView> {
  if (periodMonth >= currentMonthString()) {
    throw new TaxInvoiceDomainError("PERIOD_NOT_ELAPSED");
  }

  const aggregate = await getBuyerMonthPaidTotal(userId, periodMonth);
  if (!aggregate) throw new TaxInvoiceDomainError("NO_PAID_ORDERS", 404);

  const existing = await prisma.taxInvoice.findUnique({
    where: { userId_periodMonth: { userId, periodMonth } },
  });

  if (existing) {
    if (existing.status === "REQUESTED" || existing.status === "ISSUED") {
      throw new TaxInvoiceDomainError("ALREADY_REQUESTED_OR_ISSUED");
    }
    const reopened = await prisma.taxInvoice.update({
      where: { id: existing.id },
      data: {
        supplyAmount: aggregate.supplyAmount,
        vat: aggregate.vat,
        totalAmount: aggregate.total,
        status: "REQUESTED",
        rejectReason: null,
        externalId: null,
        issuedAt: null,
        issuedBy: null,
        requestedAt: new Date(),
      },
    });
    return toTaxInvoiceView(reopened);
  }

  try {
    const created = await prisma.taxInvoice.create({
      data: {
        userId,
        periodMonth,
        supplyAmount: aggregate.supplyAmount,
        vat: aggregate.vat,
        totalAmount: aggregate.total,
      },
    });
    return toTaxInvoiceView(created);
  } catch (error) {
    // Lost a race against a concurrent request for the same (userId,
    // periodMonth) — the `existing` read above found nothing, but another
    // request's create() landed first. Same "loser gets a domain error, not
    // a 500" pattern as createReview/createReturnRequest.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TaxInvoiceDomainError("ALREADY_REQUESTED_OR_ISSUED");
    }
    throw error;
  }
}

/** The signed-in buyer's own requests — /mypage/tax. */
export async function getBuyerTaxInvoices(userId: string): Promise<TaxInvoiceView[]> {
  const invoices = await prisma.taxInvoice.findMany({
    where: { userId },
    orderBy: { periodMonth: "desc" },
  });
  return invoices.map(toTaxInvoiceView);
}

const adminTaxInvoiceInclude = {
  user: { select: { businessName: true, ownerName: true, loginId: true } },
} satisfies Prisma.TaxInvoiceInclude;

type AdminTaxInvoiceRecord = Prisma.TaxInvoiceGetPayload<{ include: typeof adminTaxInvoiceInclude }>;

function toAdminTaxInvoiceView(record: AdminTaxInvoiceRecord): AdminTaxInvoiceView {
  return { ...toTaxInvoiceView(record), user: record.user };
}

/** Admin's queue — every buyer's requests, optionally filtered by status. */
export async function getAdminTaxInvoices(status?: string): Promise<AdminTaxInvoiceView[]> {
  const validStatus =
    status && ["REQUESTED", "ISSUED", "REJECTED", "CANCELED"].includes(status)
      ? (status as "REQUESTED" | "ISSUED" | "REJECTED" | "CANCELED")
      : undefined;
  const invoices = await prisma.taxInvoice.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    // asc sorts by TaxInvoiceStatus's *declared* enum order (REQUESTED,
    // ISSUED, REJECTED, CANCELED — schema.prisma), putting the
    // needs-attention REQUESTED rows first. Same declaration-order
    // reasoning as getAdminReturnRequests in returns.ts.
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    include: adminTaxInvoiceInclude,
  });
  return invoices.map(toAdminTaxInvoiceView);
}

export type IssueTaxInvoiceResult =
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_STATUS"; status: string }
  | { kind: "OK"; taxInvoice: TaxInvoiceView };

/** REQUESTED -> ISSUED, recording the external system's own approval number. */
export async function issueTaxInvoice(
  taxInvoiceId: string,
  adminId: string,
  data: z.infer<typeof issueTaxInvoiceSchema>,
): Promise<IssueTaxInvoiceResult> {
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.taxInvoice.findUnique({ where: { id: taxInvoiceId } });
    if (!invoice) return { kind: "NOT_FOUND" as const };
    if (invoice.status !== "REQUESTED") return { kind: "INVALID_STATUS" as const, status: invoice.status };

    const updated = await tx.taxInvoice.update({
      where: { id: taxInvoiceId },
      data: {
        status: "ISSUED",
        externalId: data.externalId,
        issuedAt: new Date(),
        issuedBy: adminId,
        rejectReason: null,
      },
    });
    await tx.adminActionLog.create({
      data: { adminId, action: "TAX_INVOICE_ISSUE", targetType: "TaxInvoice", targetId: taxInvoiceId },
    });
    return { kind: "OK" as const, record: updated };
  });

  if (result.kind !== "OK") return result;

  await notifyUser(result.record.userId, "BUYER_TAX_INVOICE_ISSUED", {
    subject: "세금계산서가 발행되었습니다",
    body: `${result.record.periodMonth} 세금계산서가 발행되었습니다.`,
  });

  return { kind: "OK" as const, taxInvoice: toTaxInvoiceView(result.record) };
}

export type RejectTaxInvoiceResult =
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_STATUS"; status: string }
  | { kind: "OK"; taxInvoice: TaxInvoiceView };

/** REQUESTED -> REJECTED, with a reason. */
export async function rejectTaxInvoice(
  taxInvoiceId: string,
  adminId: string,
  data: z.infer<typeof rejectTaxInvoiceSchema>,
): Promise<RejectTaxInvoiceResult> {
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.taxInvoice.findUnique({ where: { id: taxInvoiceId } });
    if (!invoice) return { kind: "NOT_FOUND" as const };
    if (invoice.status !== "REQUESTED") return { kind: "INVALID_STATUS" as const, status: invoice.status };

    const updated = await tx.taxInvoice.update({
      where: { id: taxInvoiceId },
      data: { status: "REJECTED", rejectReason: data.reason },
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "TAX_INVOICE_REJECT",
        targetType: "TaxInvoice",
        targetId: taxInvoiceId,
        reason: data.reason,
      },
    });
    return { kind: "OK" as const, record: updated };
  });

  if (result.kind !== "OK") return result;

  await notifyUser(result.record.userId, "BUYER_TAX_INVOICE_REJECTED", {
    subject: "세금계산서 신청이 반려되었습니다",
    body: `${result.record.periodMonth} 세금계산서 신청이 반려되었습니다. 사유: ${result.record.rejectReason}`,
  });

  return { kind: "OK" as const, taxInvoice: toTaxInvoiceView(result.record) };
}
