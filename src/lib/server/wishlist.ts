import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { WishSeller } from "@/lib/types";
import { prisma } from "./prisma";

export const wishSellerSchema = z.object({
  type: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(40),
  location: z.string().trim().max(160),
  intro: z.string().trim().max(500),
});

function toWishSeller(entry: Prisma.WishlistEntryGetPayload<object>): WishSeller {
  return {
    id: entry.id,
    type: entry.type,
    code: entry.code,
    location: entry.location,
    intro: entry.intro,
    wishedAt: entry.wishedAt.toISOString().slice(0, 10),
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
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function getWishlist(userId: string) {
  const entries = await prisma.wishlistEntry.findMany({
    where: { userId },
    orderBy: { wishedAt: "desc" },
  });
  return entries.map(toWishSeller);
}

export async function toggleWishlist(userId: string, data: z.infer<typeof wishSellerSchema>) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.wishlistEntry.findFirst({
      where: { userId, code: data.code },
    });
    if (existing) {
      await tx.wishlistEntry.delete({ where: { id: existing.id } });
      return { wished: false as const, seller: null };
    }

    const created = await tx.wishlistEntry.create({
      data: { userId, ...data },
    });
    return { wished: true as const, seller: toWishSeller(created) };
  });
}

export async function removeWishlist(userId: string, entryId: string) {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.wishlistEntry.deleteMany({
      where: { id: entryId, userId },
    });
    return deleted.count === 1;
  });
}
