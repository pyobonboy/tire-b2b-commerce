import { BuyerStatus, ListingStatus, Prisma, SellerStatus, type ShippingStatus } from "@prisma/client";
import { z } from "zod";
import { SHIPPING_STATUS_LABEL, isCancelledOrderStatus, nextOrderStatusForShipping } from "@/lib/order-status";
import { requireRole } from "./guard";
import { prisma } from "./prisma";
import { expireStaleUnpaidOrders } from "./orders";
import { shippingRank, shippingSchema, serverErrorResponse, validationResponse } from "./seller";
import { notifyUser } from "./notify";

const adminSellerInclude = {
  user: {
    select: {
      id: true,
      loginId: true,
      businessName: true,
      businessRegNumber: true,
      ownerName: true,
      email: true,
      mobilePhone: true,
      officePhone: true,
      postalCode: true,
      address: true,
      createdAt: true,
    },
  },
  _count: { select: { listings: true } },
} satisfies Prisma.SellerInclude;

const adminBuyerInclude = {
  user: {
    select: {
      id: true,
      loginId: true,
      businessName: true,
      businessRegNumber: true,
      ownerName: true,
      email: true,
      mobilePhone: true,
      officePhone: true,
      postalCode: true,
      address: true,
      createdAt: true,
    },
  },
} satisfies Prisma.BuyerInclude;

const adminListingInclude = {
  product: true,
  seller: {
    select: {
      id: true,
      code: true,
      status: true,
      // userId is not part of toAdminListingView's output — it's read only
      // by reviewAdminListing, to notify the seller's own User row after
      // approving/rejecting a listing.
      userId: true,
      user: { select: { businessName: true, ownerName: true } },
    },
  },
} satisfies Prisma.ListingInclude;

const adminOrderInclude = {
  listing: {
    include: {
      product: true,
      seller: {
        select: {
          id: true,
          code: true,
          user: { select: { businessName: true } },
        },
      },
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
  payment: {
    select: {
      id: true,
      status: true,
      refundRequiredAt: true,
      refundReason: true,
      refundAmount: true,
    },
  },
} satisfies Prisma.OrderInclude;

type AdminSellerRecord = Prisma.SellerGetPayload<{ include: typeof adminSellerInclude }>;
type AdminBuyerRecord = Prisma.BuyerGetPayload<{ include: typeof adminBuyerInclude }>;
type AdminListingRecord = Prisma.ListingGetPayload<{ include: typeof adminListingInclude }>;
type AdminOrderRecord = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>;

export const adminReviewSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const adminDelistSchema = z.object({
  reason: z.string().trim().min(1, "사유를 입력해 주세요.").max(500),
});

export const adminSuspendSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const adminShippingSchema = shippingSchema.extend({
  reason: z.string().trim().max(500).optional(),
});

export async function requireAdmin() {
  const auth = await requireRole(["ADMIN"]);
  if (auth.response) {
    return { session: null, adminId: null, response: auth.response } as const;
  }
  return { session: auth.session, adminId: auth.session.user.id, response: null } as const;
}

export { serverErrorResponse, validationResponse };

function toAdminSellerView(seller: AdminSellerRecord) {
  return {
    id: seller.id,
    code: seller.code,
    status: seller.status,
    courier: seller.courier,
    shippingNote: seller.shippingNote,
    location: seller.location,
    intro: seller.intro,
    approvedAt: seller.approvedAt?.toISOString() ?? null,
    suspendReason: seller.suspendReason,
    user: {
      ...seller.user,
      createdAt: seller.user.createdAt.toISOString(),
    },
    listingCount: seller._count.listings,
  };
}

function toAdminBuyerView(buyer: AdminBuyerRecord) {
  return {
    id: buyer.id,
    status: buyer.status,
    approvedAt: buyer.approvedAt?.toISOString() ?? null,
    approvedBy: buyer.approvedBy,
    rejectedReason: buyer.rejectedReason,
    suspendReason: buyer.suspendReason,
    user: {
      ...buyer.user,
      createdAt: buyer.user.createdAt.toISOString(),
    },
  };
}

function toAdminListingView(listing: AdminListingRecord) {
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
    updatedAt: listing.updatedAt.toISOString(),
    seller: {
      id: listing.seller.id,
      code: listing.seller.code,
      status: listing.seller.status,
      businessName: listing.seller.user.businessName,
      ownerName: listing.seller.user.ownerName,
    },
  };
}

// Task 4 — same reasoning as resolveOrderShipping in seller.ts (which this
// mirrors exactly): the admin screen used to read the buyer's live
// User.postalCode/address here too. Prefer the order's own snapshot, and
// fall back to the live buyer record only for the fields that can still be
// null after the backfill migration (in practice just postalCode/address —
// recipientName/recipientPhone were backfilled from User's NOT NULL
// ownerName/mobilePhone). addressDetail/deliveryNote have no User-side
// equivalent and simply stay null on pre-migration orders.
function resolveOrderShipping(order: AdminOrderRecord) {
  return {
    recipientName: order.recipientName ?? order.buyer.ownerName,
    recipientPhone: order.recipientPhone ?? order.buyer.mobilePhone,
    postalCode: order.postalCode ?? order.buyer.postalCode,
    address: order.address ?? order.buyer.address,
    addressDetail: order.addressDetail,
    deliveryNote: order.deliveryNote,
  };
}

function toAdminOrderView(order: AdminOrderRecord) {
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
    seller: {
      id: order.listing.seller.id,
      code: order.listing.seller.code,
      businessName: order.listing.seller.user.businessName,
    },
    // businessName/ownerName/mobilePhone identify WHO placed the order and
    // are always read live — `shipping` below is the per-order snapshot of
    // where it actually ships, which is the thing this task fixes.
    buyer: {
      businessName: order.buyer.businessName,
      ownerName: order.buyer.ownerName,
      mobilePhone: order.buyer.mobilePhone,
      officePhone: order.buyer.officePhone,
    },
    shipping: resolveOrderShipping(order),
    payment: order.payment
      ? {
          id: order.payment.id,
          status: order.payment.status,
          refundRequiredAt: order.payment.refundRequiredAt?.toISOString() ?? null,
          refundReason: order.payment.refundReason,
          refundAmount: order.payment.refundAmount,
        }
      : null,
  };
}

export async function getAdminSellers(status?: string) {
  const validStatus = status && Object.values(SellerStatus).includes(status as SellerStatus)
    ? (status as SellerStatus)
    : undefined;
  const sellers = await prisma.seller.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    orderBy: { user: { createdAt: "desc" } },
    include: adminSellerInclude,
  });
  return sellers.map(toAdminSellerView);
}

export async function approveAdminSeller(sellerId: string, adminId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUnique({ where: { id: sellerId } });
    if (!seller) return { kind: "NOT_FOUND" as const };
    if (seller.status !== "PENDING") {
      return { kind: "INVALID_STATUS" as const, status: seller.status };
    }

    const updated = await tx.seller.update({
      where: { id: sellerId },
      data: {
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedBy: adminId,
        suspendReason: null,
      },
      include: adminSellerInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "SELLER_APPROVE",
        targetType: "Seller",
        targetId: sellerId,
      },
    });
    return { kind: "OK" as const, seller: toAdminSellerView(updated) };
  });

  // Notification fires only after the transaction above has committed —
  // never from inside it, since an external send is a side effect Postgres
  // cannot roll back (see notify.ts / cancelOrder's Toss-refund comment).
  if (result.kind === "OK") {
    await notifyUser(result.seller.user.id, "SELLER_APPROVED", {
      subject: "판매자 승인이 완료되었습니다",
      body: "판매자 가입이 승인되었습니다. 이제 상품을 등록하고 판매를 시작할 수 있습니다.",
    });
  }
  return result;
}

export async function suspendAdminSeller(sellerId: string, adminId: string, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUnique({ where: { id: sellerId } });
    if (!seller) return { kind: "NOT_FOUND" as const };
    if (seller.status === "SUSPENDED") {
      return { kind: "INVALID_STATUS" as const, status: seller.status };
    }

    const updated = await tx.seller.update({
      where: { id: sellerId },
      data: { status: "SUSPENDED", suspendReason: reason },
      include: adminSellerInclude,
    });
    // getPublicProducts/getPublicProduct and findActiveListing already filter
    // out listings from a non-ACTIVE seller, so this isn't required for
    // correctness — but flipping the listings to HIDDEN keeps the seller's
    // own listing dashboard honest while they're suspended, instead of
    // showing listings as "판매중" that no buyer can actually see or order.
    // See reinstateAdminSeller below for the HIDDEN -> ACTIVE/SOLDOUT restore
    // path taken when this suspension is later lifted.
    await tx.listing.updateMany({
      where: { sellerId, status: "ACTIVE" },
      data: { status: "HIDDEN" },
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "SELLER_SUSPEND",
        targetType: "Seller",
        targetId: sellerId,
        reason,
      },
    });
    return { kind: "OK" as const, seller: toAdminSellerView(updated) };
  });

  if (result.kind === "OK") {
    await notifyUser(result.seller.user.id, "SELLER_SUSPENDED", {
      subject: "판매자 계정이 정지되었습니다",
      body: `판매자 계정이 정지되었습니다. 사유: ${reason}`,
    });
  }
  return result;
}

export async function reinstateAdminSeller(sellerId: string, adminId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      include: { user: { select: { withdrawnAt: true } } },
    });
    if (!seller) return { kind: "NOT_FOUND" as const };
    if (seller.status !== "SUSPENDED") {
      return { kind: "INVALID_STATUS" as const, status: seller.status };
    }

    const updated = await tx.seller.update({
      where: { id: sellerId },
      data: { status: "ACTIVE", suspendReason: null },
      include: adminSellerInclude,
    });

    // Restore the listings suspendAdminSeller hid.
    //
    // LIMITATION: Listing has no hiddenReason/hiddenAt column (and this
    // function may not add one — schema.prisma is off limits), so a HIDDEN
    // listing can't say *why* it's HIDDEN. We can't literally read back
    // "did suspension hide this one", so this restore leans on an invariant
    // of the current codebase instead of guessing:
    //
    // Today there are exactly two places that ever set a listing to HIDDEN —
    // this suspend/reinstate pair, and withdrawAccount (a seller's own,
    // permanent withdrawal, which is independent of Seller.status and never
    // un-does itself). There is no seller-facing "hide my own listing"
    // action anywhere in this codebase. So for a seller whose user has NOT
    // withdrawn, every listing that is currently HIDDEN must have been
    // hidden by a prior suspension, and restoring all of them here is
    // correct, not a guess. If a future feature adds a seller-initiated hide
    // action, this invariant breaks and a real hiddenReason/hiddenAt column
    // should replace this reasoning rather than extending it.
    //
    // For a withdrawn seller, a HIDDEN listing could instead (or also) have
    // been hidden by that withdrawal, and there is no way to tell which.
    // Reinstating such a seller doesn't let them sell again anyway —
    // requireSeller still blocks a withdrawn user from logging in — so we
    // leave their listings untouched rather than risk resurrecting
    // withdrawal-hidden ones as ACTIVE/SOLDOUT.
    //
    // Restored status mirrors reviewAdminListing/updateSellerListing's own
    // ACTIVE-vs-SOLDOUT rule: a listing with no stock left comes back as
    // SOLDOUT, not ACTIVE.
    if (!seller.user.withdrawnAt) {
      await tx.listing.updateMany({
        where: { sellerId, status: "HIDDEN", stock: { gt: 0 } },
        data: { status: "ACTIVE" },
      });
      await tx.listing.updateMany({
        where: { sellerId, status: "HIDDEN", stock: 0 },
        data: { status: "SOLDOUT" },
      });
    }

    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "SELLER_REINSTATE",
        targetType: "Seller",
        targetId: sellerId,
      },
    });
    return { kind: "OK" as const, seller: toAdminSellerView(updated) };
  });

  if (result.kind === "OK") {
    await notifyUser(result.seller.user.id, "SELLER_REINSTATED", {
      subject: "판매자 계정 정지가 해제되었습니다",
      body: "판매자 계정 정지가 해제되었습니다. 다시 판매를 진행할 수 있습니다.",
    });
  }
  return result;
}

export async function getAdminBuyers(status?: string) {
  const validStatus = status && Object.values(BuyerStatus).includes(status as BuyerStatus)
    ? (status as BuyerStatus)
    : undefined;
  const buyers = await prisma.buyer.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    orderBy: { user: { createdAt: "desc" } },
    include: adminBuyerInclude,
  });
  return buyers.map(toAdminBuyerView);
}

export async function approveAdminBuyer(buyerId: string, adminId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const buyer = await tx.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) return { kind: "NOT_FOUND" as const };
    if (buyer.status !== "PENDING") {
      return { kind: "INVALID_STATUS" as const, status: buyer.status };
    }

    const updated = await tx.buyer.update({
      where: { id: buyerId },
      data: {
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedBy: adminId,
        rejectedReason: null,
        suspendReason: null,
      },
      include: adminBuyerInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "BUYER_APPROVE",
        targetType: "Buyer",
        targetId: buyerId,
      },
    });
    return { kind: "OK" as const, buyer: toAdminBuyerView(updated) };
  });

  if (result.kind === "OK") {
    await notifyUser(result.buyer.user.id, "BUYER_APPROVED", {
      subject: "구매회원 가입이 승인되었습니다",
      body: "구매회원 가입이 승인되었습니다. 이제 로그인하여 주문을 진행할 수 있습니다.",
    });
  }
  return result;
}

export async function rejectAdminBuyer(buyerId: string, adminId: string, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const buyer = await tx.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) return { kind: "NOT_FOUND" as const };
    if (buyer.status !== "PENDING") {
      return { kind: "INVALID_STATUS" as const, status: buyer.status };
    }

    const updated = await tx.buyer.update({
      where: { id: buyerId },
      data: { status: "REJECTED", rejectedReason: reason },
      include: adminBuyerInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "BUYER_REJECT",
        targetType: "Buyer",
        targetId: buyerId,
        reason,
      },
    });
    return { kind: "OK" as const, buyer: toAdminBuyerView(updated) };
  });

  if (result.kind === "OK") {
    await notifyUser(result.buyer.user.id, "BUYER_REJECTED", {
      subject: "구매회원 가입이 반려되었습니다",
      body: `구매회원 가입이 반려되었습니다. 사유: ${reason}`,
    });
  }
  return result;
}

export async function suspendAdminBuyer(buyerId: string, adminId: string, reason: string) {
  const result = await prisma.$transaction(async (tx) => {
    const buyer = await tx.buyer.findUnique({ where: { id: buyerId } });
    if (!buyer) return { kind: "NOT_FOUND" as const };
    if (buyer.status === "SUSPENDED") {
      return { kind: "INVALID_STATUS" as const, status: buyer.status };
    }

    const updated = await tx.buyer.update({
      where: { id: buyerId },
      data: { status: "SUSPENDED", suspendReason: reason },
      include: adminBuyerInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "BUYER_SUSPEND",
        targetType: "Buyer",
        targetId: buyerId,
        reason,
      },
    });
    return { kind: "OK" as const, buyer: toAdminBuyerView(updated) };
  });

  if (result.kind === "OK") {
    await notifyUser(result.buyer.user.id, "BUYER_SUSPENDED", {
      subject: "구매회원 계정이 정지되었습니다",
      body: `구매회원 계정이 정지되었습니다. 사유: ${reason}`,
    });
  }
  return result;
}

export async function getAdminListings(status?: string) {
  const validStatus = status && Object.values(ListingStatus).includes(status as ListingStatus)
    ? (status as ListingStatus)
    : undefined;
  const listings = await prisma.listing.findMany({
    where: validStatus ? { status: validStatus } : undefined,
    orderBy: { updatedAt: "desc" },
    include: adminListingInclude,
  });
  const priority: Record<ListingStatus, number> = {
    PENDING: 0,
    REJECTED: 1,
    DRAFT: 2,
    ACTIVE: 3,
    SOLDOUT: 4,
    HIDDEN: 5,
  };
  return listings
    .sort((a, b) => priority[a.status] - priority[b.status])
    .map(toAdminListingView);
}

export async function reviewAdminListing(
  listingId: string,
  adminId: string,
  data: z.infer<typeof adminReviewSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing) return { kind: "NOT_FOUND" as const };
    if (listing.status !== "PENDING") {
      return { kind: "INVALID_STATUS" as const, status: listing.status };
    }
    if (!data.approve && !data.reason?.trim()) {
      return { kind: "REASON_REQUIRED" as const };
    }

    const status = data.approve ? (listing.stock > 0 ? "ACTIVE" : "SOLDOUT") : "REJECTED";
    const updated = await tx.listing.update({
      where: { id: listingId },
      data: {
        status,
        rejectedReason: data.approve ? null : data.reason,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
      include: adminListingInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: data.approve ? "LISTING_APPROVE" : "LISTING_REJECT",
        targetType: "Listing",
        targetId: listingId,
        reason: data.approve ? null : data.reason,
      },
    });
    return { kind: "OK" as const, listing: toAdminListingView(updated), sellerUserId: updated.seller.userId };
  });

  if (result.kind === "OK") {
    // Notification fires only after the transaction above has committed —
    // never from inside it (see notify.ts).
    await notifyUser(
      result.sellerUserId,
      data.approve ? "LISTING_APPROVED" : "LISTING_REJECTED",
      data.approve
        ? {
            subject: "상품 등록이 승인되었습니다",
            body: "등록하신 상품이 승인되어 판매가 시작되었습니다.",
          }
        : {
            subject: "상품 등록이 반려되었습니다",
            body: `등록하신 상품이 반려되었습니다. 사유: ${data.reason}`,
          },
    );
    return { kind: "OK" as const, listing: result.listing };
  }
  return result;
}

// 이미 게시된(ACTIVE/SOLDOUT) 상품을 판매 중지시킬 때는 HIDDEN이 아니라
// REJECTED로 보낸다. HIDDEN은 suspendAdminSeller/reinstateAdminSeller
// 전용 상태다 — 판매자를 정지시키면 그 판매자의 ACTIVE 상품이 모두
// HIDDEN으로 바뀌고, 이후 판매자를 복귀시키면 reinstateAdminSeller가
// "그 판매자의 HIDDEN 상품은 전부 정지 때문에 숨겨진 것"이라고 가정하고
// ACTIVE/SOLDOUT으로 일괄 복원한다. 만약 여기서도 HIDDEN을 쓰면, 정책
// 위반으로 판매 중지시킨 상품이 나중에 (관련 없는) 판매자 정지→복귀
// 사이클만으로 조용히 다시 노출되어 버린다. REJECTED는 이 충돌이 없고,
// 구매자 목록 조회에서도 제외되며(products.ts는 ACTIVE만 노출), 판매자의
// 기존 재심사 제출 경로로 복구할 수 있다.
export async function delistAdminListing(
  listingId: string,
  adminId: string,
  data: z.infer<typeof adminDelistSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing) return { kind: "NOT_FOUND" as const };
    if (listing.status !== "ACTIVE" && listing.status !== "SOLDOUT") {
      return { kind: "INVALID_STATUS" as const, status: listing.status };
    }

    const updated = await tx.listing.update({
      where: { id: listingId },
      data: {
        status: "REJECTED",
        rejectedReason: data.reason,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
      include: adminListingInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "LISTING_DELIST",
        targetType: "Listing",
        targetId: listingId,
        reason: data.reason,
      },
    });
    return { kind: "OK" as const, listing: toAdminListingView(updated), sellerUserId: updated.seller.userId };
  });

  if (result.kind === "OK") {
    // Notification fires only after the transaction above has committed —
    // never from inside it (see notify.ts).
    await notifyUser(result.sellerUserId, "LISTING_REJECTED", {
      subject: "상품이 판매 중지되었습니다",
      body: `등록하신 상품이 판매 중지되었습니다. 사유: ${data.reason}`,
    });
    return { kind: "OK" as const, listing: result.listing };
  }
  return result;
}

export async function getAdminOrders() {
  // Unlike getBuyerOrders/getSellerOrders, the admin order list is
  // intentionally global (every buyer/seller's orders), so this expiry pass
  // isn't scoped to a single user — pass an empty filter to expire stale
  // 입금대기 orders across the whole table. See expireStaleUnpaidOrders in
  // src/lib/server/orders.ts for why this lazy expiry exists at all.
  await expireStaleUnpaidOrders({});

  const orders = await prisma.order.findMany({
    orderBy: { orderedAt: "desc" },
    include: adminOrderInclude,
  });
  return orders.map(toAdminOrderView);
}

export async function updateAdminShipping(
  orderId: string,
  adminId: string,
  data: z.infer<typeof adminShippingSchema>,
) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { kind: "NOT_FOUND" as const };

    // Deliberately no unpaid/cancelled guard here (unlike updateSellerShipping):
    // this codebase already carves admins out of the equivalent restriction in
    // cancelOrder (`actor.kind !== "ADMIN"`), so admins are trusted to
    // override shipping state on a cancelled or unpaid order too — e.g. to
    // correct a mistake a seller already made under the guard below.
    const shippingStatus = data.shippingStatus as ShippingStatus;

    // order.status must still never be resurrected on a cancelled order, even
    // though shippingStatus itself is allowed to change above. Unlike
    // updateSellerShipping (which never reaches this point on a cancelled
    // order at all, thanks to its earlier guard), this path has no such
    // guard, so it checks isCancelledOrderStatus explicitly here rather than
    // relying on nextOrderStatusForShipping's rank lookup happening to return
    // null for an unranked status — that's an implementation detail of the
    // shared helper, not a contract this must-never-happen invariant should
    // depend on. The shipping write itself (below) still goes through
    // unconditionally either way, preserving the admin override.
    const advancedOrderStatus = isCancelledOrderStatus(order.status)
      ? null
      : nextOrderStatusForShipping(order.status, shippingStatus);

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        shippingStatus,
        ...(advancedOrderStatus ? { status: advancedOrderStatus } : {}),
        ...(data.courier !== undefined ? { courier: data.courier || null } : {}),
        ...(data.trackingNumber !== undefined ? { trackingNumber: data.trackingNumber || null } : {}),
        ...(shippingStatus === "SHIPPED" && !order.shippedAt ? { shippedAt: new Date() } : {}),
        ...(shippingStatus === "DELIVERED" && !order.deliveredAt ? { deliveredAt: new Date() } : {}),
      },
      include: adminOrderInclude,
    });
    await tx.adminActionLog.create({
      data: {
        adminId,
        action: "ORDER_SHIPPING_OVERRIDE",
        targetType: "Order",
        targetId: orderId,
        reason: data.reason ?? null,
      },
    });
    return {
      kind: "OK" as const,
      order: toAdminOrderView(updated),
      buyerId: updated.buyerId,
      // Only "advanced" (never a same-or-backwards admin correction) should
      // trigger the buyer-facing notification — see shippingRank's export
      // comment in seller.ts.
      isAdvance: shippingRank[shippingStatus] > shippingRank[order.shippingStatus],
      newShippingStatus: shippingStatus,
    };
  });

  if (result.kind === "OK" && result.isAdvance) {
    await notifyUser(result.buyerId, "BUYER_ORDER_SHIPPED", {
      subject: "배송 상태가 변경되었습니다",
      body: `주문(${result.order.id})의 배송 상태가 '${SHIPPING_STATUS_LABEL[result.newShippingStatus]}'(으)로 변경되었습니다.`,
    });
  }

  if (result.kind === "OK") {
    return { kind: "OK" as const, order: result.order };
  }
  return result;
}
