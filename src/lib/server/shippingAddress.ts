// ---------------------------------------------------------------------------
// Task 1 — 배송지 주소록 (ShippingAddress)
// ---------------------------------------------------------------------------
// Buyer-scoped CRUD over ShippingAddress. The one invariant this whole file
// exists to protect: a user with at least one address always has EXACTLY one
// marked isDefault — never zero (a stranded book with no default to
// preselect at checkout) and never two (an ambiguous preselection). The
// schema has no partial unique index to lean on for this (schema.prisma is
// off limits for this task), so it is enforced purely in application code,
// inside a transaction, at the only three places isDefault can ever change:
//   1. createShippingAddress — the first address a user ever saves is forced
//      default regardless of what the caller asked for (a book with rows but
//      no default would otherwise be reachable the moment someone's first
//      save omits isDefault); a later address becomes default only if asked,
//      and only after every other row's flag is cleared first.
//   2. setDefaultShippingAddress — the only way to change which existing
//      address is default. Clears every other row's flag, then sets this one,
//      in one transaction.
//   3. deleteShippingAddress — deleting the current default when other rows
//      remain must promote one of them, or the invariant breaks the moment
//      the default is removed.
// updateShippingAddress deliberately cannot touch isDefault at all (see
// updateShippingAddressSchema) — that keeps "change the address fields" and
// "change which address is default" as two separate, independently reasoned
// operations instead of one that has to re-derive the invariant from
// whatever else was in the request body.
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "./prisma";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

// Required fields mirror the Order shipping snapshot (shippingSnapshotSchema
// in src/lib/server/orders.ts) exactly, plus `label` (this table's own — an
// Order snapshot has no use for a book-entry name) and `isDefault` (create
// only; see the module header).
const shippingAddressFields = {
  label: z.string().trim().min(1).max(40),
  recipientName: z.string().trim().min(1).max(60),
  recipientPhone: z.string().trim().min(1).max(30),
  postalCode: z.string().trim().min(1).max(20),
  address: z.string().trim().min(1).max(300),
  addressDetail: nullableText(200),
};

export const createShippingAddressSchema = z.object({
  ...shippingAddressFields,
  isDefault: z.boolean().optional(),
});

// No isDefault — see the module header for why that only ever changes via
// setDefaultShippingAddress.
export const updateShippingAddressSchema = z.object(shippingAddressFields).partial();

export class ShippingAddressDomainError extends Error {
  constructor(
    public readonly code: "ADDRESS_NOT_FOUND",
    public readonly status = 404,
  ) {
    super(code);
    this.name = "ShippingAddressDomainError";
  }
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json(
    { error: "VALIDATION_ERROR", details: error.issues },
    { status: 400 },
  );
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof ShippingAddressDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "DUPLICATE_RESOURCE" }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

function toShippingAddressView(address: {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  address: string;
  addressDetail: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    postalCode: address.postalCode,
    address: address.address,
    addressDetail: address.addressDetail,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

export type ShippingAddressView = ReturnType<typeof toShippingAddressView>;

// Default first (so the checkout picker can always preselect list[0] when one
// exists), then most recently updated — matches the "most relevant first"
// ordering the rest of this codebase uses for buyer-facing lists.
export async function listShippingAddresses(userId: string) {
  const addresses = await prisma.shippingAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return addresses.map(toShippingAddressView);
}

export async function createShippingAddress(
  userId: string,
  data: z.infer<typeof createShippingAddressSchema>,
) {
  const created = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.shippingAddress.count({ where: { userId } });
    // The first address for this user is always the default — otherwise a
    // buyer who saves exactly one address and never touches isDefault would
    // end up with a book that has rows but no default, which is exactly the
    // state this module exists to make unreachable.
    const makeDefault = existingCount === 0 || data.isDefault === true;

    if (makeDefault && existingCount > 0) {
      await tx.shippingAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.shippingAddress.create({
      data: {
        userId,
        label: data.label,
        recipientName: data.recipientName,
        recipientPhone: data.recipientPhone,
        postalCode: data.postalCode,
        address: data.address,
        addressDetail: data.addressDetail ?? null,
        isDefault: makeDefault,
      },
    });
  });
  return toShippingAddressView(created);
}

export async function updateShippingAddress(
  userId: string,
  id: string,
  data: z.infer<typeof updateShippingAddressSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.shippingAddress.updateMany({
      where: { id, userId },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.recipientName !== undefined ? { recipientName: data.recipientName } : {}),
        ...(data.recipientPhone !== undefined ? { recipientPhone: data.recipientPhone } : {}),
        ...(data.postalCode !== undefined ? { postalCode: data.postalCode } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.addressDetail !== undefined ? { addressDetail: data.addressDetail } : {}),
      },
    });
    if (updated.count !== 1) throw new ShippingAddressDomainError("ADDRESS_NOT_FOUND");
    const address = await tx.shippingAddress.findUniqueOrThrow({ where: { id } });
    return toShippingAddressView(address);
  });
}

// The only way isDefault ever moves onto an *existing* row — see the module
// header. Unsets every other address of this user first, then sets this one,
// both inside one transaction so no read of this user's addresses from
// outside can ever observe two rows (or zero) marked default.
export async function setDefaultShippingAddress(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.shippingAddress.findFirst({ where: { id, userId } });
    if (!target) throw new ShippingAddressDomainError("ADDRESS_NOT_FOUND");

    if (!target.isDefault) {
      await tx.shippingAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.shippingAddress.update({ where: { id }, data: { isDefault: true } });
    }

    const address = await tx.shippingAddress.findUniqueOrThrow({ where: { id } });
    return toShippingAddressView(address);
  });
}

// Deleting the default when other addresses remain must promote one of them
// — otherwise the invariant (module header) breaks the instant the default
// row is removed. The most recently updated survivor is promoted, mirroring
// listShippingAddresses' own "most relevant first" ordering.
export async function deleteShippingAddress(userId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.shippingAddress.findFirst({ where: { id, userId } });
    if (!target) throw new ShippingAddressDomainError("ADDRESS_NOT_FOUND");

    // Guarded deleteMany (not a plain delete) — same pattern as
    // removeCartItem/removeWishlist elsewhere in this codebase — so a
    // same-user double-submit racing this exact deletion reports a clean
    // ADDRESS_NOT_FOUND on the loser instead of throwing a Prisma
    // record-not-found error out of the transaction.
    const deleted = await tx.shippingAddress.deleteMany({ where: { id, userId } });
    if (deleted.count !== 1) throw new ShippingAddressDomainError("ADDRESS_NOT_FOUND");

    if (target.isDefault) {
      const nextDefault = await tx.shippingAddress.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
      if (nextDefault) {
        await tx.shippingAddress.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }
  });
}
