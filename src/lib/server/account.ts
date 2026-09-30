import { Prisma, type Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CANCEL_STATUS } from "@/lib/order-status";
import type { AccountProfile } from "@/lib/account-types";
import { bankVerificationProvider, type BankVerificationResult } from "./bankVerification";
import { prisma } from "./prisma";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

export const accountPatchSchema = z.object({
  email: z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().email().max(160).nullable().optional(),
  ),
  notifyOptIn: z.boolean().optional(),
  postalCode: nullableText(20),
  address: nullableText(300),
  officePhone: nullableText(30),
  mobilePhone: z.string().trim().min(7).max(30).optional(),
  contact1: nullableText(80),
  contact2: nullableText(80),
  bankName: nullableText(80),
  bankAccountNumber: nullableText(80),
  bankAccountHolder: nullableText(80),
});

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(1).max(80),
  bankAccountNumber: z.string().trim().min(1).max(80),
  bankAccountHolder: z.string().trim().min(1).max(80),
});

export class AccountDomainError extends Error {
  constructor(
    public readonly code:
      | "ACCOUNT_NOT_FOUND"
      | "ACCOUNT_ALREADY_WITHDRAWN"
      | "ACTIVE_ORDERS_EXIST"
      | "SELLER_PROFILE_NOT_FOUND",
    public readonly status = 409,
  ) {
    super(code);
    this.name = "AccountDomainError";
  }
}

const accountSelect = {
  id: true,
  loginId: true,
  role: true,
  email: true,
  notifyOptIn: true,
  businessName: true,
  businessRegNumber: true,
  businessType: true,
  businessCategory: true,
  ownerName: true,
  postalCode: true,
  address: true,
  officePhone: true,
  mobilePhone: true,
  contact1: true,
  contact2: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountHolder: true,
  bankAccountVerifiedAt: true,
  withdrawnAt: true,
} satisfies Prisma.UserSelect;

type AccountRecord = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

function toAccountProfile(user: AccountRecord): AccountProfile {
  return {
    ...user,
    role: user.role as AccountProfile["role"],
    bankAccountVerifiedAt: user.bankAccountVerifiedAt?.toISOString() ?? null,
    withdrawnAt: user.withdrawnAt?.toISOString() ?? null,
  };
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json(
    { error: "VALIDATION_ERROR", details: error.issues },
    { status: 400 },
  );
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof AccountDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function getAccountProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: accountSelect });
  if (!user) throw new AccountDomainError("ACCOUNT_NOT_FOUND", 404);
  return toAccountProfile(user);
}

export async function updateAccountProfile(
  userId: string,
  data: z.infer<typeof accountPatchSchema>,
) {
  const bankChanged =
    data.bankName !== undefined ||
    data.bankAccountNumber !== undefined ||
    data.bankAccountHolder !== undefined;
  const user = await prisma.$transaction((tx) =>
    tx.user.update({
      where: { id: userId },
      data: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.notifyOptIn !== undefined ? { notifyOptIn: data.notifyOptIn } : {}),
        ...(data.postalCode !== undefined ? { postalCode: data.postalCode } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.officePhone !== undefined ? { officePhone: data.officePhone } : {}),
        ...(data.mobilePhone !== undefined ? { mobilePhone: data.mobilePhone } : {}),
        ...(data.contact1 !== undefined ? { contact1: data.contact1 } : {}),
        ...(data.contact2 !== undefined ? { contact2: data.contact2 } : {}),
        ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
        ...(data.bankAccountNumber !== undefined
          ? { bankAccountNumber: data.bankAccountNumber }
          : {}),
        ...(data.bankAccountHolder !== undefined
          ? { bankAccountHolder: data.bankAccountHolder }
          : {}),
        ...(bankChanged ? { bankAccountVerifiedAt: null } : {}),
      },
      select: accountSelect,
    }),
  );
  return toAccountProfile(user);
}

export async function saveBankAccount(
  userId: string,
  data: z.infer<typeof bankAccountSchema>,
): Promise<{ profile: AccountProfile; verification: BankVerificationResult }> {
  // Ask the configured provider first (see bankVerification.ts) — today that
  // is always the "not configured" provider, so `verification.verified` is
  // always false and `verifiedAt` always null, but the write below no longer
  // hard-codes that; it just persists whatever the provider actually
  // reported, so swapping in a real provider later requires no change here.
  const verification = await bankVerificationProvider.verify(data);

  const user = await prisma.$transaction((tx) =>
    tx.user.update({
      where: { id: userId },
      data: {
        bankName: data.bankName,
        bankAccountNumber: data.bankAccountNumber,
        bankAccountHolder: data.bankAccountHolder,
        bankAccountVerifiedAt: verification.verifiedAt,
      },
      select: accountSelect,
    }),
  );
  return { profile: toAccountProfile(user), verification };
}

const cancelledStatuses = Object.values(CANCEL_STATUS);

export async function withdrawAccount(userId: string, role: Role, sellerId: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { withdrawnAt: true, loginId: true },
    });
    if (!user) throw new AccountDomainError("ACCOUNT_NOT_FOUND", 404);
    if (user.withdrawnAt) throw new AccountDomainError("ACCOUNT_ALREADY_WITHDRAWN");

    if (role === "BUYER" || role === "SELLER") {
      const orderOwnerFilter =
        role === "BUYER" ? { buyerId: userId } : sellerId ? { sellerId } : null;
      if (!orderOwnerFilter) throw new AccountDomainError("SELLER_PROFILE_NOT_FOUND");

      // Order.sellerId stores Seller.id, so seller withdrawal uses the session sellerId.
      const activeOrders = await tx.order.count({
        where: {
          ...orderOwnerFilter,
          status: { notIn: cancelledStatuses },
          shippingStatus: { not: "DELIVERED" },
        },
      });
      if (activeOrders > 0) throw new AccountDomainError("ACTIVE_ORDERS_EXIST");
    }

    if (role === "SELLER" && sellerId) {
      // Withdrawal is also filtered out by getPublicProducts/getPublicProduct
      // and findActiveListing via user.withdrawnAt, but hide the listings too
      // so the (now inaccessible) seller dashboard doesn't keep showing them
      // as on sale. See suspendAdminSeller for why there's no HIDDEN -> ACTIVE
      // restore path yet.
      await tx.listing.updateMany({
        where: { sellerId, status: "ACTIVE" },
        data: { status: "HIDDEN" },
      });
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        withdrawnAt: new Date(),
        // Tombstone both unique identifiers so this business can sign up
        // again under a fresh account. Both loginId and businessRegNumber
        // stay NOT NULL columns (no schema-wide nullability change forced by
        // one withdrawal path), so each is rewritten to a value derived from
        // this row's own id: guaranteed unique against every other row
        // (tombstoned or not) and, for businessRegNumber, guaranteed to never
        // collide with a real checksum-valid 10-digit number (all-digits) —
        // see the @unique comment on User.businessRegNumber in schema.prisma.
        // auth.ts's authorize() looks up the *original* loginId the caller
        // typed via findUnique, so once it no longer matches this row at all
        // it can never authenticate against this (already withdrawnAt-gated)
        // account — this only changes what re-registers, not login behavior.
        loginId: `${user.loginId}#withdrawn#${userId}`,
        businessRegNumber: `WITHDRAWN#${userId}`,

        // PII scrub. This is a commercial marketplace with tax and dispute
        // obligations, so Order/Payment rows (and the FKs pointing at this
        // User) are left completely alone — only the contact/financial detail
        // on the User row itself, which nothing downstream needs once the
        // account is gone, gets cleared:
        //   - businessRegNumber: tombstoned above, not merely retained —
        //     leaving a real registration number sitting here forever is
        //     exactly what this task flags as wrong.
        //   - ownerName, mobilePhone: NOT NULL columns, so replaced with an
        //     inert placeholder rather than left holding a real name/phone.
        //   - email, officePhone, contact1/2, postalCode, address, bankName,
        //     bankAccountNumber, bankAccountHolder, bankAccountVerifiedAt:
        //     nullable, cleared outright.
        // Retained on purpose: businessName (not in the PII list this task
        // calls out — it's a company name, not a personal identifier, and
        // stays attached to historical Order / seller-order-view records so
        // past order history still shows which business the order was
        // with), businessType/businessCategory (industry classification, not
        // personally identifying), role, createdAt, and every Order/Payment/
        // CartItem/WishlistEntry row (foreign keys untouched).
        ownerName: "탈퇴한 회원",
        email: null,
        mobilePhone: "",
        officePhone: null,
        contact1: null,
        contact2: null,
        postalCode: null,
        address: null,
        bankName: null,
        bankAccountNumber: null,
        bankAccountHolder: null,
        bankAccountVerifiedAt: null,
      },
      select: { withdrawnAt: true },
    });
  });
  if (!result.withdrawnAt) throw new Error("ACCOUNT_WITHDRAW_TIMESTAMP_MISSING");
  return { withdrawnAt: result.withdrawnAt.toISOString() };
}
