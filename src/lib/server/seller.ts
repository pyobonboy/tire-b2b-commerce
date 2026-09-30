import { hash } from "bcryptjs";
import { ListingStatus, Prisma, type ShippingStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ORDER_STATUS,
  SHIPPING_STATUS_LABEL,
  isCancelledOrderStatus,
  nextOrderStatusForShipping,
} from "@/lib/order-status";
import { isValidBusinessRegNumber, normalizeBusinessRegNumber } from "@/lib/business-reg-number";
import { prisma } from "./prisma";
import { requireRole } from "./guard";
import { expireStaleUnpaidOrders } from "./orders";
import { isAllowedListingImageUrl } from "./storage";
import { notifyUser } from "./notify";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

const tagSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.enum(["EVENT", "BEST"]).nullable().optional(),
);

// Same empty-string-means-null convention as nullableText above, for a
// numeric field: freeShippingThreshold has no natural "unset" value of its
// own (0 is a legitimate, meaningful threshold), so the form sends "" and
// this maps that to null ("무료배송 기준 없음") rather than to 0 ("무료배송
// 기준 0원", i.e. always free).
const nullableNumber = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.coerce.number().int().min(0).max(max).nullable().optional(),
  );

export const listingSchema = z.object({
  manufacturer: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(160),
  width: z.coerce.number().int().min(1).max(999),
  ratio: z.coerce.number().int().min(1).max(999),
  rim: z.coerce.number().int().min(1).max(99),
  dot: z.string().trim().min(1).max(20),
  loadIndex: z.string().trim().min(1).max(20),
  speedIndex: z.string().trim().min(1).max(20),
  ply: z.string().trim().min(1).max(20),
  oe: nullableText(40),
  season: z.string().trim().min(1).max(80),
  productCode: z.string().trim().min(1).max(80),
  discountRate: z.coerce.number().min(0).max(100),
  price: z.coerce.number().int().min(0).max(100_000_000),
  factoryPrice: z.coerce.number().int().min(0).max(100_000_000),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  minOrder: z.coerce.number().int().min(1).max(100_000),
  tag: tagSchema,
  shippingNote: nullableText(500),
  courier: z.string().trim().min(1).max(80).optional(),
  // Task 2 — 배송비. Seller-wide settings, edited from the same listing form
  // as courier/shippingNote (see the tx.seller.update block below) rather
  // than a separate seller-settings screen — this codebase doesn't have one,
  // and courier/shippingNote already established this exact pattern of
  // seller-wide fields living on the per-listing form.
  shippingFee: z.coerce.number().int().min(0).max(1_000_000).optional(),
  freeShippingThreshold: nullableNumber(100_000_000),
  // Not `.url()` — zod 4.4.3's `.url()` only checks that a string parses as
  // *some* URL, which accepts `javascript:`/`data:` URIs and any external
  // host. The actual restriction (this app's own storage origin only, with a
  // grandfather exception for URLs already persisted on the listing being
  // edited) can only be enforced at request time against runtime config
  // (`S3_PUBLIC_BASE_URL`), not in this module-level schema — see
  // isAllowedListingImageUrl (storage.ts) for why, and createSellerListing /
  // updateSellerListing below for where that check actually runs.
  imageUrls: z.array(z.string().trim().min(1).max(2_000)).max(10).optional(),
});

export const listingPatchSchema = listingSchema.partial();

export const sellerSignupSchema = z.object({
  loginId: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/),
  password: z.string().min(8).max(100),
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/)
    .transform((value) => value.toUpperCase()),
  businessName: z.string().trim().min(1).max(120),
  // Normalise before validating so "123-45-67890" and "1234567890" are
  // treated (and stored) as the same value, and enforce the official
  // checksum — see business-reg-number.ts. This is scoped to
  // sellerSignupSchema only (this file's other schemas are owned elsewhere).
  businessRegNumber: z
    .string()
    .trim()
    .transform(normalizeBusinessRegNumber)
    .refine(isValidBusinessRegNumber, { message: "사업자등록번호 형식이 올바르지 않습니다." }),
  ownerName: z.string().trim().min(1).max(80),
  mobilePhone: z.string().trim().min(7).max(30),
  courier: z.string().trim().min(1).max(80),
  email: nullableText(160),
  businessType: nullableText(80),
  businessCategory: nullableText(120),
  postalCode: nullableText(20),
  address: nullableText(300),
  officePhone: nullableText(30),
  contact1: nullableText(80),
  contact2: nullableText(80),
  shippingNote: nullableText(500),
  location: nullableText(120),
  intro: nullableText(500),
});

export const shippingSchema = z.object({
  shippingStatus: z.enum(["PREPARING", "TRACKING_REGISTERED", "SHIPPED", "DELIVERED"]),
  courier: z.string().trim().max(80).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
});

const sellerListingInclude = {
  product: true,
  seller: {
    select: {
      id: true,
      code: true,
      courier: true,
      shippingNote: true,
      location: true,
      intro: true,
      shippingFee: true,
      freeShippingThreshold: true,
    },
  },
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ListingInclude;

const sellerOrderInclude = {
  listing: {
    include: {
      product: true,
      seller: { select: { code: true } },
    },
  },
  buyer: {
    select: {
      businessName: true,
      ownerName: true,
      mobilePhone: true,
      officePhone: true,
      postalCode: true,
      address: true,
    },
  },
} satisfies Prisma.OrderInclude;

type SellerListingRecord = Prisma.ListingGetPayload<{
  include: typeof sellerListingInclude;
}>;

type SellerOrderRecord = Prisma.OrderGetPayload<{
  include: typeof sellerOrderInclude;
}>;

export type SellerListingView = ReturnType<typeof toListingView>;
export type SellerOrderView = ReturnType<typeof toOrderView>;

export async function requireSeller() {
  const auth = await requireRole(["SELLER"]);

  if (auth.response) {
    return { session: null, sellerId: null, response: auth.response } as const;
  }

  const sellerId = auth.session.user.sellerId;
  if (!sellerId) {
    return {
      session: null,
      sellerId: null,
      response: NextResponse.json({ error: "SELLER_PROFILE_REQUIRED" }, { status: 403 }),
    } as const;
  }

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { status: true },
  });
  if (!seller || seller.status !== "ACTIVE") {
    return {
      session: null,
      sellerId: null,
      response: NextResponse.json({ error: "SELLER_INACTIVE" }, { status: 403 }),
    } as const;
  }

  return { session: auth.session, sellerId, response: null } as const;
}

export function validationResponse(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return NextResponse.json(
    { error: "VALIDATION_ERROR", details: error.issues },
    { status: 400 },
  );
}

export class SellerDomainError extends Error {
  constructor(
    public readonly code: "LISTING_IMAGE_URL_NOT_ALLOWED",
    public readonly status = 400,
  ) {
    super(code);
    this.name = "SellerDomainError";
  }
}

export function domainErrorResponse(error: unknown) {
  if (!(error instanceof SellerDomainError)) return null;
  if (error.code === "LISTING_IMAGE_URL_NOT_ALLOWED") {
    return NextResponse.json(
      {
        error: error.code,
        message:
          "상품 이미지는 이미지 등록 기능으로 업로드한 파일만 사용할 수 있습니다. 외부 URL은 등록할 수 없습니다.",
      },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: error.code }, { status: error.status });
}

export function serverErrorResponse(error: unknown, message = "SELLER_REQUEST_FAILED") {
  console.error(message, error);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "DUPLICATE_RESOURCE" }, { status: 409 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

function toListingView(listing: SellerListingRecord) {
  return {
    id: listing.id,
    status: listing.status,
    rejectedReason: listing.rejectedReason,
    manufacturer: listing.product.manufacturer,
    model: listing.product.model,
    width: listing.product.width,
    ratio: listing.product.ratio,
    rim: listing.product.rim,
    dot: listing.dot,
    loadIndex: listing.loadIndex,
    speedIndex: listing.speedIndex,
    ply: listing.ply,
    oe: listing.oe,
    season: listing.season,
    productCode: listing.productCode,
    discountRate: Number(listing.discountRate),
    price: listing.price,
    factoryPrice: listing.factoryPrice,
    stock: listing.stock,
    minOrder: listing.minOrder,
    tag: listing.tag,
    submittedAt: listing.submittedAt?.toISOString() ?? null,
    reviewedAt: listing.reviewedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    seller: listing.seller,
    images: listing.images.map((image) => ({
      id: image.id,
      url: image.url,
      sortOrder: image.sortOrder,
    })),
  };
}

// Task 4 — the seller screen used to read the buyer's live User.postalCode/
// address here (order.buyer.postalCode/address, straight from the include
// below) — exactly the bug the ShippingAddress/Order-snapshot feature
// exists to fix (see schema.prisma's comment on Order.recipientName): a
// buyer editing their profile silently rewrote where an already-shipped
// order had gone. This now prefers the order's own snapshot and falls back
// to the live buyer record only for a field that snapshot doesn't have —
// which in practice means only pre-migration orders, and only for
// postalCode/address at that (recipientName/recipientPhone were backfilled
// from User.ownerName/mobilePhone, both NOT NULL columns, so they're never
// actually null in practice; postalCode/address can still be null if the
// buyer's own profile address was already empty at backfill time).
// addressDetail/deliveryNote have no User-side equivalent at all, so there is
// nothing to fall back to and they simply stay null on old orders.
function resolveOrderShipping(order: SellerOrderRecord) {
  return {
    recipientName: order.recipientName ?? order.buyer.ownerName,
    recipientPhone: order.recipientPhone ?? order.buyer.mobilePhone,
    postalCode: order.postalCode ?? order.buyer.postalCode,
    address: order.address ?? order.buyer.address,
    addressDetail: order.addressDetail,
    deliveryNote: order.deliveryNote,
  };
}

function toOrderView(order: SellerOrderRecord) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    listingId: order.listingId,
    sellerId: order.sellerId,
    status: order.status,
    shippingStatus: order.shippingStatus,
    courier: order.courier,
    trackingNumber: order.trackingNumber,
    quantity: order.quantity,
    unitPrice: order.unitPrice,
    extraShipping: order.extraShipping,
    shippingFee: order.shippingFee,
    total: order.unitPrice * order.quantity + order.extraShipping + order.shippingFee,
    orderedAt: order.orderedAt.toISOString(),
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    product: {
      manufacturer: order.listing.product.manufacturer,
      model: order.listing.product.model,
      width: order.listing.product.width,
      ratio: order.listing.product.ratio,
      rim: order.listing.product.rim,
      dot: order.listing.dot,
      sellerCode: order.listing.seller.code,
    },
    // businessName/ownerName/mobilePhone here identify WHO placed the order
    // (the buyer's account) and are always read live — unlike shipping,
    // there's no snapshot concept for "who bought this". Where to actually
    // send the package is `shipping` below, which is the per-order snapshot.
    buyer: {
      businessName: order.buyer.businessName,
      ownerName: order.buyer.ownerName,
      mobilePhone: order.buyer.mobilePhone,
      officePhone: order.buyer.officePhone,
    },
    shipping: resolveOrderShipping(order),
  };
}

export async function getSellerListings(sellerId: string, status?: string) {
  const validStatus = status && Object.values(ListingStatus).includes(status as ListingStatus)
    ? (status as ListingStatus)
    : undefined;

  const listings = await prisma.listing.findMany({
    where: { sellerId, ...(validStatus ? { status: validStatus } : {}) },
    orderBy: { updatedAt: "desc" },
    include: sellerListingInclude,
  });
  return listings.map(toListingView);
}

export async function getSellerListing(sellerId: string, listingId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, sellerId },
    include: sellerListingInclude,
  });
  return listing ? toListingView(listing) : null;
}

function productKey(data: {
  manufacturer: string;
  model: string;
  width: number;
  ratio: number;
  rim: number;
}) {
  return {
    manufacturer_model_width_ratio_rim: {
      manufacturer: data.manufacturer,
      model: data.model,
      width: data.width,
      ratio: data.ratio,
      rim: data.rim,
    },
  };
}

export async function createSellerListing(
  sellerId: string,
  data: z.infer<typeof listingSchema>,
) {
  // A brand-new listing has no pre-existing images of its own, so every URL
  // must already sit on this app's own storage origin — no grandfather
  // exception applies here (contrast updateSellerListing below).
  if (data.imageUrls?.some((url) => !isAllowedListingImageUrl(url))) {
    throw new SellerDomainError("LISTING_IMAGE_URL_NOT_ALLOWED");
  }

  const listing = await prisma.$transaction(async (tx) => {
    const product = await tx.product.upsert({
      where: productKey(data),
      create: {
        manufacturer: data.manufacturer,
        model: data.model,
        width: data.width,
        ratio: data.ratio,
        rim: data.rim,
      },
      update: {},
    });

    const created = await tx.listing.create({
      data: {
        productId: product.id,
        sellerId,
        status: "DRAFT",
        dot: data.dot,
        loadIndex: data.loadIndex,
        speedIndex: data.speedIndex,
        ply: data.ply,
        oe: data.oe ?? null,
        season: data.season,
        productCode: data.productCode,
        discountRate: data.discountRate,
        price: data.price,
        factoryPrice: data.factoryPrice,
        stock: data.stock,
        minOrder: data.minOrder,
        tag: data.tag ?? null,
        ...(data.imageUrls
          ? { images: { create: data.imageUrls.map((url, index) => ({ url, sortOrder: index })) } }
          : {}),
      },
    });

    if (
      data.courier !== undefined ||
      data.shippingNote !== undefined ||
      data.shippingFee !== undefined ||
      data.freeShippingThreshold !== undefined
    ) {
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          ...(data.courier !== undefined ? { courier: data.courier } : {}),
          ...(data.shippingNote !== undefined ? { shippingNote: data.shippingNote } : {}),
          ...(data.shippingFee !== undefined ? { shippingFee: data.shippingFee } : {}),
          ...(data.freeShippingThreshold !== undefined
            ? { freeShippingThreshold: data.freeShippingThreshold }
            : {}),
        },
      });
    }

    return tx.listing.findUniqueOrThrow({
      where: { id: created.id },
      include: sellerListingInclude,
    });
  });

  return toListingView(listing);
}

const CORE_FIELDS = [
  "manufacturer",
  "model",
  "width",
  "ratio",
  "rim",
  "dot",
  "loadIndex",
  "speedIndex",
  "ply",
  "oe",
  "season",
  "productCode",
] as const;

export async function updateSellerListing(
  sellerId: string,
  listingId: string,
  data: z.infer<typeof listingPatchSchema>,
  changedBy: string,
) {
  const listing = await prisma.$transaction(async (tx) => {
    const existing = await tx.listing.findFirst({
      where: { id: listingId, sellerId },
      include: { product: true, images: { select: { url: true } } },
    });
    if (!existing) return null;

    if (data.imageUrls !== undefined) {
      // Grandfather exception: a URL already persisted on *this* listing
      // (e.g. saved before this restriction existed) may be kept as-is even
      // if it isn't on this app's own storage origin — otherwise a seller
      // editing such a listing could never save it again. Any URL not
      // already on the listing must be on our own storage origin, same as
      // createSellerListing.
      const existingUrls = new Set(existing.images.map((image) => image.url));
      if (data.imageUrls.some((url) => !isAllowedListingImageUrl(url, existingUrls))) {
        throw new SellerDomainError("LISTING_IMAGE_URL_NOT_ALLOWED");
      }
    }

    const nextProduct = {
      manufacturer: data.manufacturer ?? existing.product.manufacturer,
      model: data.model ?? existing.product.model,
      width: data.width ?? existing.product.width,
      ratio: data.ratio ?? existing.product.ratio,
      rim: data.rim ?? existing.product.rim,
    };
    const currentValues: Record<string, unknown> = {
      manufacturer: existing.product.manufacturer,
      model: existing.product.model,
      width: existing.product.width,
      ratio: existing.product.ratio,
      rim: existing.product.rim,
      dot: existing.dot,
      loadIndex: existing.loadIndex,
      speedIndex: existing.speedIndex,
      ply: existing.ply,
      oe: existing.oe,
      season: existing.season,
      productCode: existing.productCode,
    };
    const nextValues: Record<string, unknown> = {
      manufacturer: nextProduct.manufacturer,
      model: nextProduct.model,
      width: nextProduct.width,
      ratio: nextProduct.ratio,
      rim: nextProduct.rim,
      dot: data.dot ?? existing.dot,
      loadIndex: data.loadIndex ?? existing.loadIndex,
      speedIndex: data.speedIndex ?? existing.speedIndex,
      ply: data.ply ?? existing.ply,
      oe: data.oe !== undefined ? data.oe : existing.oe,
      season: data.season ?? existing.season,
      productCode: data.productCode ?? existing.productCode,
    };
    const coreChanged = CORE_FIELDS.some(
      (field) => String(currentValues[field] ?? "") !== String(nextValues[field] ?? ""),
    );

    const nextStock = data.stock ?? existing.stock;
    let status = existing.status;
    if (coreChanged && existing.status === "ACTIVE") status = "PENDING";
    if (nextStock === 0 && (status === "ACTIVE" || status === "SOLDOUT")) status = "SOLDOUT";
    if (nextStock > 0 && status === "SOLDOUT" && !coreChanged) status = "ACTIVE";

    const product = await tx.product.upsert({
      where: productKey(nextProduct),
      create: nextProduct,
      update: {},
    });

    const priceChanges = [
      ["price", existing.price, data.price],
      ["discountRate", Number(existing.discountRate), data.discountRate],
      ["stock", existing.stock, data.stock],
      ["factoryPrice", existing.factoryPrice, data.factoryPrice],
    ].flatMap(([field, oldValue, newValue]) =>
      newValue !== undefined && oldValue !== newValue
        ? [{ field: String(field), oldValue: String(oldValue), newValue: String(newValue), changedBy }]
        : [],
    );

    const updated = await tx.listing.update({
      where: { id: listingId },
      data: {
        productId: product.id,
        ...(data.dot !== undefined ? { dot: data.dot } : {}),
        ...(data.loadIndex !== undefined ? { loadIndex: data.loadIndex } : {}),
        ...(data.speedIndex !== undefined ? { speedIndex: data.speedIndex } : {}),
        ...(data.ply !== undefined ? { ply: data.ply } : {}),
        ...(data.oe !== undefined ? { oe: data.oe } : {}),
        ...(data.season !== undefined ? { season: data.season } : {}),
        ...(data.productCode !== undefined ? { productCode: data.productCode } : {}),
        ...(data.discountRate !== undefined ? { discountRate: data.discountRate } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.factoryPrice !== undefined ? { factoryPrice: data.factoryPrice } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.minOrder !== undefined ? { minOrder: data.minOrder } : {}),
        ...(data.tag !== undefined ? { tag: data.tag } : {}),
        status,
        ...(coreChanged && existing.status === "ACTIVE"
          ? {
              submittedAt: new Date(),
              rejectedReason: null,
              reviewedAt: null,
              reviewedBy: null,
            }
          : {}),
        ...(priceChanges.length ? { priceHistory: { create: priceChanges } } : {}),
      },
    });

    if (data.imageUrls !== undefined) {
      await tx.listingImage.deleteMany({ where: { listingId } });
      if (data.imageUrls.length) {
        await tx.listingImage.createMany({
          data: data.imageUrls.map((url, index) => ({ listingId, url, sortOrder: index })),
        });
      }
    }

    if (
      data.courier !== undefined ||
      data.shippingNote !== undefined ||
      data.shippingFee !== undefined ||
      data.freeShippingThreshold !== undefined
    ) {
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          ...(data.courier !== undefined ? { courier: data.courier } : {}),
          ...(data.shippingNote !== undefined ? { shippingNote: data.shippingNote } : {}),
          ...(data.shippingFee !== undefined ? { shippingFee: data.shippingFee } : {}),
          ...(data.freeShippingThreshold !== undefined
            ? { freeShippingThreshold: data.freeShippingThreshold }
            : {}),
        },
      });
    }

    return tx.listing.findUniqueOrThrow({
      where: { id: updated.id },
      include: sellerListingInclude,
    });
  });

  return listing ? toListingView(listing) : null;
}

export async function submitSellerListing(sellerId: string, listingId: string) {
  const listing = await prisma.listing.findFirst({ where: { id: listingId, sellerId } });
  if (!listing) return { kind: "NOT_FOUND" as const };
  if (listing.status !== "DRAFT" && listing.status !== "REJECTED") {
    return { kind: "INVALID_STATUS" as const, status: listing.status };
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: {
      status: "PENDING",
      submittedAt: new Date(),
      rejectedReason: null,
    },
    include: sellerListingInclude,
  });
  return { kind: "OK" as const, listing: toListingView(updated) };
}

export async function deleteSellerListing(sellerId: string, listingId: string) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findFirst({ where: { id: listingId, sellerId } });
    if (!listing) return { kind: "NOT_FOUND" as const };
    if (listing.status !== "DRAFT") {
      return { kind: "INVALID_STATUS" as const, status: listing.status };
    }

    await tx.listingPriceChange.deleteMany({ where: { listingId } });
    await tx.listingImage.deleteMany({ where: { listingId } });
    await tx.listing.delete({ where: { id: listingId } });
    const remaining = await tx.listing.count({ where: { productId: listing.productId } });
    if (remaining === 0) await tx.product.delete({ where: { id: listing.productId } });
    return { kind: "OK" as const };
  });
}

export async function createSellerApplication(data: z.infer<typeof sellerSignupSchema>) {
  const passwordHash = await hash(data.password, 10);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        loginId: data.loginId,
        passwordHash,
        role: "SELLER",
        email: data.email ?? null,
        businessName: data.businessName,
        businessRegNumber: data.businessRegNumber,
        businessType: data.businessType ?? null,
        businessCategory: data.businessCategory ?? null,
        ownerName: data.ownerName,
        postalCode: data.postalCode ?? null,
        address: data.address ?? null,
        officePhone: data.officePhone ?? null,
        mobilePhone: data.mobilePhone,
        contact1: data.contact1 ?? null,
        contact2: data.contact2 ?? null,
      },
    });

    return tx.seller.create({
      data: {
        userId: user.id,
        code: data.code,
        status: "PENDING",
        courier: data.courier,
        shippingNote: data.shippingNote ?? null,
        location: data.location ?? null,
        intro: data.intro ?? null,
      },
      select: { id: true, code: true, status: true },
    });
  });
}

export async function getSellerOrders(sellerId: string) {
  // Scoped to this seller only, mirroring getBuyerOrders — see
  // expireStaleUnpaidOrders in src/lib/server/orders.ts for why this lazy
  // expiry exists at all (no cron/worker in this deployment).
  await expireStaleUnpaidOrders({ sellerId });

  const orders = await prisma.order.findMany({
    where: { sellerId },
    orderBy: { orderedAt: "desc" },
    include: sellerOrderInclude,
  });
  return orders.map(toOrderView);
}

// Exported so updateAdminShipping (admin.ts) can also tell "advanced" apart
// from "reset backwards" without duplicating this table — admins are allowed
// to reset shippingStatus to an earlier value (to correct a mistake), and
// that path shouldn't fire the same buyer-facing "shipping advanced"
// notification this rank table gates below.
export const shippingRank: Record<ShippingStatus, number> = {
  PREPARING: 0,
  TRACKING_REGISTERED: 1,
  SHIPPED: 2,
  DELIVERED: 3,
};

export async function updateSellerShipping(
  sellerId: string,
  orderId: string,
  data: z.infer<typeof shippingSchema>,
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, sellerId },
    include: sellerOrderInclude,
  });
  if (!order) return { kind: "NOT_FOUND" as const };

  // order.status only ever reflects payment/cancellation, never shipping, so
  // it has to be checked separately from the shippingRank transition below.
  // Without this a seller could mark an order that was never paid for (still
  // 입금대기) or one that's already cancelled (입금전취소/입금후취소) as
  // 발송완료 — and cancelOrder then refuses to cancel a SHIPPED/DELIVERED
  // order for non-admin actors, so that permanently locks the buyer out of
  // cancelling an order they never actually paid for.
  if (isCancelledOrderStatus(order.status)) {
    return { kind: "ORDER_CANCELLED" as const };
  }
  if (order.status === ORDER_STATUS.PAYMENT_PENDING) {
    return { kind: "ORDER_UNPAID" as const };
  }

  const nextStatus = data.shippingStatus as ShippingStatus;
  if (shippingRank[nextStatus] < shippingRank[order.shippingStatus]) {
    return { kind: "INVALID_TRANSITION" as const };
  }

  // An empty submitted value means "keep the current value", not "clear it" —
  // the seller order list always prefills these inputs with the current
  // value (`?? ""`), so a blank field here means the seller never touched it,
  // not that they deliberately erased it. Save must use these same
  // fallback-to-existing values (not a fresh `data.X || null`), or a save
  // with a blank input would pass the TRACKING_REQUIRED check below using the
  // old value and then persist null, leaving a SHIPPED order with no
  // tracking number.
  const trackingNumber = data.trackingNumber?.trim() || order.trackingNumber;
  const courier = data.courier?.trim() || order.courier;
  if ((nextStatus === "TRACKING_REGISTERED" || nextStatus === "SHIPPED") && !trackingNumber) {
    return { kind: "TRACKING_REQUIRED" as const };
  }

  // The guards above already refused a cancelled or still-입금대기 order, so
  // order.status here is guaranteed to be a ranked, non-cancelled
  // ORDER_STATUS value - nextOrderStatusForShipping is safe to call directly
  // without an extra isCancelledOrderStatus check here (contrast
  // updateAdminShipping in admin.ts, which has no such guard above it and so
  // must check explicitly). This is the single shared shipping->status
  // mapping (order-status.ts) that keeps this path and the admin override
  // path from drifting apart, and it never moves order.status backwards.
  const advancedOrderStatus = nextOrderStatusForShipping(order.status, nextStatus);

  const previousShippingStatus = order.shippingStatus;

  // Guarded updateMany on both order.status and order.shippingStatus — same
  // lost-the-race pattern as confirmPurchase/completeReturnRequest. Guarding
  // on both catches a concurrent buyer cancel (status changed) AND a
  // concurrent admin shipping override (shippingStatus changed) since either
  // one invalidates the checks already run above against the stale read.
  const marked = await prisma.order.updateMany({
    where: { id: orderId, status: order.status, shippingStatus: order.shippingStatus },
    data: {
      shippingStatus: nextStatus,
      ...(advancedOrderStatus ? { status: advancedOrderStatus } : {}),
      courier: courier ?? null,
      trackingNumber: trackingNumber ?? null,
      ...(nextStatus === "SHIPPED" && !order.shippedAt ? { shippedAt: new Date() } : {}),
      ...(nextStatus === "DELIVERED" && !order.deliveredAt ? { deliveredAt: new Date() } : {}),
    },
  });
  if (marked.count !== 1) return { kind: "ORDER_STATE_CHANGED" as const };

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: sellerOrderInclude });

  // Buyer-facing "shipping status advanced" notification — only when the
  // shipping status actually changed (a seller re-saving the same status
  // with, say, a corrected tracking number shouldn't re-notify the buyer).
  // No prisma.$transaction wraps this update, so there's no rollback concern
  // here, but the notification still only fires after the update above has
  // resolved, matching the "after commit" rule everywhere else (notify.ts).
  if (nextStatus !== previousShippingStatus) {
    await notifyUser(updated.buyerId, "BUYER_ORDER_SHIPPED", {
      subject: "배송 상태가 변경되었습니다",
      body: `주문(${updated.id})의 배송 상태가 '${SHIPPING_STATUS_LABEL[nextStatus]}'(으)로 변경되었습니다.`,
    });
  }

  return { kind: "OK" as const, order: toOrderView(updated) };
}

// Explicit seller action for 주문확인 (Task: this ORDER_STATUS value has no
// shipping-status trigger - see SHIPPING_STATUS_TO_ORDER_STATUS in
// order-status.ts - so unlike the other transitions it needs its own entry
// point rather than riding along with updateSellerShipping). Only valid from
// 입금완료: a seller shouldn't be able to "confirm" an order that hasn't been
// paid for yet, and once shipping has already started (or 주문확인 already
// happened) this is a no-op that would otherwise silently do nothing while
// looking like it succeeded.
export async function confirmSellerOrder(sellerId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, sellerId },
    include: sellerOrderInclude,
  });
  if (!order) return { kind: "NOT_FOUND" as const };
  if (order.status !== ORDER_STATUS.PAYMENT_COMPLETED) {
    return { kind: "INVALID_STATUS" as const, status: order.status };
  }

  // Guarded updateMany on the order's own current status — same
  // lost-the-race pattern as confirmPurchase/completeReturnRequest, so a
  // concurrent status change between the read above and this write can't be
  // silently overwritten.
  const marked = await prisma.order.updateMany({
    where: { id: orderId, status: ORDER_STATUS.PAYMENT_COMPLETED },
    data: { status: ORDER_STATUS.ORDER_CONFIRMED },
  });
  if (marked.count !== 1) {
    const fresh = await prisma.order.findUnique({ where: { id: orderId } });
    return fresh ? { kind: "INVALID_STATUS" as const, status: fresh.status } : { kind: "NOT_FOUND" as const };
  }

  const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: sellerOrderInclude });
  return { kind: "OK" as const, order: toOrderView(updated) };
}
