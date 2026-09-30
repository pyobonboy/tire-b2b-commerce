import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { CartItem } from "@/lib/types";
import { prisma } from "./prisma";
import { resolveExtraShipping } from "./pricing";

export const cartItemSchema = z.object({
  tireId: z.string().trim().min(1).max(200),
  manufacturer: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  width: z.coerce.number().int().min(1).max(999),
  ratio: z.coerce.number().int().min(1).max(999),
  rim: z.coerce.number().int().min(1).max(99),
  dot: z.string().trim().min(1).max(20),
  price: z.coerce.number().int().min(0).max(100_000_000),
  quantity: z.coerce.number().int().min(1).max(100_000),
  extraShipping: z.coerce.number().int().min(0).max(1_000_000),
  sellerCode: z.string().trim().min(1).max(40),
  stock: z.coerce.number().int().min(0).max(1_000_000).optional(),
  listingId: z.string().trim().min(1).max(200).optional(),
});

export const cartQuantitySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(100_000),
});

export class CartDomainError extends Error {
  constructor(
    public readonly code: "CART_ITEM_NOT_FOUND" | "CART_QUANTITY_EXCEEDED",
    public readonly status = 404,
  ) {
    super(code);
    this.name = "CartDomainError";
  }
}

function toCartItem(item: Prisma.CartItemGetPayload<object>): CartItem {
  return {
    id: item.id,
    tireId: item.tireId,
    manufacturer: item.manufacturer as CartItem["manufacturer"],
    model: item.model,
    width: item.width,
    ratio: item.ratio,
    rim: item.rim,
    dot: item.dot,
    price: item.price,
    quantity: item.quantity,
    extraShipping: item.extraShipping,
    sellerCode: item.sellerCode,
    ...(item.stock === null ? {} : { stock: item.stock }),
    ...(item.listingId === null ? {} : { listingId: item.listingId }),
  };
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json(
    { error: "VALIDATION_ERROR", details: error.issues },
    { status: 400 },
  );
}

export function serverErrorResponse(error: unknown, message: string) {
  console.error(message, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "DUPLICATE_RESOURCE" }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof CartDomainError)) return null;
  return NextResponse.json({ error: error.code }, { status: error.status });
}

// Matches the "1시간 후 자동 삭제" copy on the cart page. There's no cron here —
// expiry is enforced lazily, by deleting stale rows for this user whenever
// their cart is read. `updatedAt` (not `createdAt`) is the basis, so adding
// more of the same line or changing its quantity resets the clock; an item
// nobody has touched for an hour is dropped. Note this only prunes the
// querying user's own rows — another user's expired rows just sit unseen
// until that user next opens their cart, which is fine since nothing reads
// them until then.
const CART_ITEM_TTL_MS = 60 * 60 * 1000;

export async function getCartItems(userId: string) {
  await prisma.cartItem.deleteMany({
    where: { userId, updatedAt: { lt: new Date(Date.now() - CART_ITEM_TTL_MS) } },
  });

  const items = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { id: "asc" },
  });
  return items.map(toCartItem);
}

export async function addCartItem(userId: string, data: z.infer<typeof cartItemSchema>) {
  // Upsert on the same key as the CartItem unique constraint (userId, tireId,
  // sellerCode, dot) makes the merge-or-create atomic, so two concurrent adds
  // of the same line can no longer race past each other the way a
  // findFirst-then-create/update pair would.
  const item = await prisma.$transaction(async (tx) => {
    const upserted = await tx.cartItem.upsert({
      where: {
        userId_tireId_sellerCode_dot: {
          userId,
          tireId: data.tireId,
          sellerCode: data.sellerCode,
          dot: data.dot,
        },
      },
      create: {
        userId,
        tireId: data.tireId,
        manufacturer: data.manufacturer,
        model: data.model,
        width: data.width,
        ratio: data.ratio,
        rim: data.rim,
        dot: data.dot,
        price: data.price,
        quantity: data.quantity,
        // Server-derived, not data.extraShipping from the request body — see
        // resolveExtraShipping (pricing.ts) for why the client's value is
        // never trusted here.
        extraShipping: resolveExtraShipping(),
        sellerCode: data.sellerCode,
        stock: data.stock ?? null,
        listingId: data.listingId ?? null,
      },
      update: {
        manufacturer: data.manufacturer,
        model: data.model,
        width: data.width,
        ratio: data.ratio,
        rim: data.rim,
        price: data.price,
        extraShipping: resolveExtraShipping(),
        stock: data.stock ?? null,
        listingId: data.listingId ?? null,
        quantity: { increment: data.quantity },
      },
    });

    if (upserted.quantity > 100_000) {
      throw new CartDomainError("CART_QUANTITY_EXCEEDED", 400);
    }
    return upserted;
  });
  return toCartItem(item);
}

export async function updateCartItem(userId: string, itemId: string, quantity: number) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.cartItem.updateMany({
      where: { id: itemId, userId },
      data: { quantity },
    });
    if (updated.count !== 1) throw new CartDomainError("CART_ITEM_NOT_FOUND");
    const item = await tx.cartItem.findUniqueOrThrow({ where: { id: itemId } });
    return toCartItem(item);
  });
}

export async function removeCartItem(userId: string, itemId: string) {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.cartItem.deleteMany({ where: { id: itemId, userId } });
    if (deleted.count !== 1) throw new CartDomainError("CART_ITEM_NOT_FOUND");
  });
}

export async function clearCart(userId: string) {
  await prisma.$transaction((tx) => tx.cartItem.deleteMany({ where: { userId } }));
}
