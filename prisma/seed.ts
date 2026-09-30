import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  FACTORY_TIRES,
  TIRES,
  TIRE_SPECS,
  getSellersForTire,
} from "../src/lib/mockData";
import type { Tire } from "../src/lib/types";

const prisma = new PrismaClient();
const PASSWORD_ROUNDS = 10;

const CANONICAL_LOGIN_IDS = ["admin", "buyer", "seller"];
const CANONICAL_SELLER_CODE = "SELLER";

type SeedAdmin = { id: string };
type SeedSeller = { id: string };

function normalFactoryPrice(price: number, discountRate: number) {
  return Math.round((price / (1 - discountRate / 100)) / 100) * 100;
}

// Reads a demo account's password from the environment, falling back to a
// well-known default only outside production. createDemoUsers() is only ever
// reached when NODE_ENV !== "production" (main() refuses SEED_DEMO_USERS=true
// in production before calling it) — the production check here is
// belt-and-suspenders, not the primary guard.
function demoPassword(envVar: string, devFallback: string): string {
  const configured = process.env[envVar];
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${envVar} must be set when running the seed script in production.`);
  }
  return devFallback;
}

// Creates the three demo accounts (buyer/seller/admin) with well-known login
// IDs. These IDs are published in this repo's README, so this must never run
// unattended against a real database: it is gated behind SEED_DEMO_USERS=true
// and refused outright in production regardless of that flag (see main()).
async function createDemoUsers() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("createDemoUsers must not run when NODE_ENV=production.");
  }

  const buyerPasswordHash = await bcrypt.hash(
    demoPassword("SEED_DEMO_BUYER_PASSWORD", "buyer1234"),
    PASSWORD_ROUNDS,
  );
  const adminPasswordHash = await bcrypt.hash(
    demoPassword("SEED_ADMIN_PASSWORD", "admin1234"),
    PASSWORD_ROUNDS,
  );
  const sellerPasswordHash = await bcrypt.hash(
    demoPassword("SEED_DEMO_SELLER_PASSWORD", "seller1234"),
    PASSWORD_ROUNDS,
  );

  const buyer = await prisma.user.upsert({
    where: { loginId: "buyer" },
    create: {
      id: "seed-buyer",
      loginId: "buyer",
      passwordHash: buyerPasswordHash,
      role: "BUYER",
      businessName: "산악타이어상사",
      businessRegNumber: "000-00-00000",
      ownerName: "홍길동",
      mobilePhone: "010-1234-5678",
    },
    update: {
      passwordHash: buyerPasswordHash,
      role: "BUYER",
      businessName: "산악타이어상사",
      ownerName: "홍길동",
      mobilePhone: "010-1234-5678",
      withdrawnAt: null,
    },
  });

  const admin = await prisma.user.upsert({
    where: { loginId: "admin" },
    create: {
      id: "seed-admin",
      loginId: "admin",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      businessName: "타이어존 본사",
      businessRegNumber: "000-00-00001",
      ownerName: "관리자",
      mobilePhone: "010-0000-0000",
    },
    update: {
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      businessName: "타이어존 본사",
      ownerName: "관리자",
      mobilePhone: "010-0000-0000",
      withdrawnAt: null,
    },
  });

  await prisma.buyer.upsert({
    where: { userId: buyer.id },
    create: {
      id: "seed-buyer-profile",
      userId: buyer.id,
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedBy: admin.id,
    },
    update: {
      userId: buyer.id,
      status: "ACTIVE",
      approvedAt: new Date(),
      approvedBy: admin.id,
      rejectedReason: null,
      suspendReason: null,
    },
  });

  const sellerUser = await prisma.user.upsert({
    where: { loginId: "seller" },
    create: {
      id: "seed-seller-user",
      loginId: "seller",
      passwordHash: sellerPasswordHash,
      role: "SELLER",
      businessName: "판매점 SELLER",
      businessRegNumber: "SEED-SELLER",
      ownerName: "판매자 SELLER",
      mobilePhone: "010-0000-0000",
    },
    update: {
      passwordHash: sellerPasswordHash,
      role: "SELLER",
      businessName: "판매점 SELLER",
      ownerName: "판매자 SELLER",
      mobilePhone: "010-0000-0000",
      withdrawnAt: null,
    },
  });

  const seller = await prisma.seller.upsert({
    where: { userId: sellerUser.id },
    create: {
      id: "seed-seller",
      userId: sellerUser.id,
      code: CANONICAL_SELLER_CODE,
      status: "ACTIVE",
      courier: "CJ대한통운",
      approvedAt: new Date(),
      approvedBy: admin.id,
    },
    update: {
      code: CANONICAL_SELLER_CODE,
      userId: sellerUser.id,
      status: "ACTIVE",
      courier: "CJ대한통운",
      approvedAt: new Date(),
      approvedBy: admin.id,
      suspendReason: null,
    },
  });

  return { buyer, admin, seller };
}

async function removeNonCanonicalSeedData() {
  return prisma.$transaction(async (tx) => {
    const staleUsers = await tx.user.findMany({
      where: { loginId: { notIn: CANONICAL_LOGIN_IDS } },
      select: {
        id: true,
        seller: { select: { id: true } },
        buyer: { select: { id: true } },
      },
    });
    if (staleUsers.length === 0) return { removedUsers: 0 };

    const staleUserIds = staleUsers.map((u) => u.id);
    const staleSellerIds = staleUsers.flatMap((u) => (u.seller ? [u.seller.id] : []));
    const staleBuyerIds = staleUsers.flatMap((u) => (u.buyer ? [u.buyer.id] : []));

    const staleListings = staleSellerIds.length > 0
      ? await tx.listing.findMany({
          where: { sellerId: { in: staleSellerIds } },
          select: { id: true },
        })
      : [];
    const staleListingIds = staleListings.map((l) => l.id);

    // Every order about to be deleted, across both axes (a stale buyer's
    // orders, and every order on a stale seller's listings). Computed up
    // front because Review.orderId / ReturnRequest.orderId /
    // SettlementAdjustment.orderId are all RESTRICT-on-delete FKs — their
    // rows must go before the order rows, or order.deleteMany below fails
    // with P2003 and aborts the whole cleanup transaction. (Same class of
    // failure the Payment comment below describes for User.)
    const staleOrders = await tx.order.findMany({
      where: {
        OR: [
          { buyerId: { in: staleUserIds } },
          ...(staleListingIds.length > 0 ? [{ listingId: { in: staleListingIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const staleOrderIds = staleOrders.map((o) => o.id);

    if (staleOrderIds.length > 0) {
      await tx.review.deleteMany({ where: { orderId: { in: staleOrderIds } } });
      await tx.returnRequest.deleteMany({ where: { orderId: { in: staleOrderIds } } });
      await tx.settlementAdjustment.deleteMany({ where: { orderId: { in: staleOrderIds } } });
    }
    // A stale buyer can also have reviewed / return-requested a canonical
    // seller's order, and a canonical buyer can have reviewed a stale
    // seller — those rows reference the stale User/Seller directly, so they
    // have to go too regardless of which orders were caught above.
    await tx.review.deleteMany({ where: { buyerId: { in: staleUserIds } } });
    await tx.returnRequest.deleteMany({ where: { buyerId: { in: staleUserIds } } });
    if (staleSellerIds.length > 0) {
      await tx.review.deleteMany({ where: { sellerId: { in: staleSellerIds } } });
      await tx.settlementAdjustment.deleteMany({ where: { sellerId: { in: staleSellerIds } } });
    }

    if (staleOrderIds.length > 0) {
      await tx.order.deleteMany({ where: { id: { in: staleOrderIds } } });
    }

    if (staleListingIds.length > 0) {
      // CartItem.listingId is ON DELETE SET NULL, so no explicit cleanup is
      // needed for it before the listing rows below are deleted.
      await tx.listingPriceChange.deleteMany({ where: { listingId: { in: staleListingIds } } });
      await tx.listingImage.deleteMany({ where: { listingId: { in: staleListingIds } } });
      await tx.listing.deleteMany({ where: { id: { in: staleListingIds } } });
    }

    // Payment.buyerId is a required, RESTRICT-on-delete FK, so payments for stale
    // buyers must be removed before the buyer's User row, or user.deleteMany below
    // fails with P2003 and leaves the earlier deletes in this half-applied.
    // PasswordResetToken / ShippingAddress / Inquiry / TaxInvoice all hold the
    // same kind of required FK to User and must go for the same reason.
    await tx.payment.deleteMany({ where: { buyerId: { in: staleUserIds } } });
    await tx.cartItem.deleteMany({ where: { userId: { in: staleUserIds } } });
    await tx.wishlistEntry.deleteMany({ where: { userId: { in: staleUserIds } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: { in: staleUserIds } } });
    await tx.shippingAddress.deleteMany({ where: { userId: { in: staleUserIds } } });
    await tx.inquiry.deleteMany({ where: { userId: { in: staleUserIds } } });
    await tx.taxInvoice.deleteMany({ where: { userId: { in: staleUserIds } } });

    if (staleBuyerIds.length > 0) {
      await tx.buyer.deleteMany({ where: { id: { in: staleBuyerIds } } });
    }

    if (staleSellerIds.length > 0) {
      // Settlement.sellerId is a required FK to Seller; its own dependents are
      // already gone by here (the seller's orders above, and that seller's
      // SettlementAdjustment rows — Adjustment.settlementId is SET NULL
      // anyway), so settlements go right before the Seller rows they block.
      await tx.settlement.deleteMany({ where: { sellerId: { in: staleSellerIds } } });
      await tx.seller.deleteMany({ where: { id: { in: staleSellerIds } } });
    }
    await tx.user.deleteMany({ where: { id: { in: staleUserIds } } });

    return { removedUsers: staleUsers.length };
  });
}

async function upsertProduct(
  manufacturer: string,
  model: string,
  width: number,
  ratio: number,
  rim: number,
) {
  return prisma.product.upsert({
    where: {
      manufacturer_model_width_ratio_rim: { manufacturer, model, width, ratio, rim },
    },
    create: { manufacturer, model, width, ratio, rim },
    update: {},
  });
}

async function upsertListing(input: {
  id: string;
  productId: string;
  sellerId: string;
  dot: string;
  loadIndex: string;
  speedIndex: string;
  ply: string;
  season: string;
  productCode: string;
  discountRate: number;
  price: number;
  factoryPrice: number;
  stock: number;
  minOrder: number;
  tag: string | null;
  adminId: string;
}) {
  const now = new Date();
  const status = input.stock > 0 ? "ACTIVE" : "SOLDOUT";

  return prisma.listing.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      productId: input.productId,
      sellerId: input.sellerId,
      status,
      dot: input.dot,
      loadIndex: input.loadIndex,
      speedIndex: input.speedIndex,
      ply: input.ply,
      season: input.season,
      productCode: input.productCode,
      discountRate: input.discountRate,
      price: input.price,
      factoryPrice: input.factoryPrice,
      stock: input.stock,
      minOrder: input.minOrder,
      tag: input.tag,
      submittedAt: now,
      reviewedAt: now,
      reviewedBy: input.adminId,
    },
    update: {
      productId: input.productId,
      sellerId: input.sellerId,
      status,
      rejectedReason: null,
      dot: input.dot,
      loadIndex: input.loadIndex,
      speedIndex: input.speedIndex,
      ply: input.ply,
      season: input.season,
      productCode: input.productCode,
      discountRate: input.discountRate,
      price: input.price,
      factoryPrice: input.factoryPrice,
      stock: input.stock,
      minOrder: input.minOrder,
      tag: input.tag,
      submittedAt: now,
      reviewedAt: now,
      reviewedBy: input.adminId,
    },
  });
}

async function seedTires(admin: SeedAdmin, seller: SeedSeller) {
  let listingCount = 0;

  for (const tire of TIRES) {
    const product = await upsertProduct(tire.manufacturer, tire.model, tire.width, tire.ratio, tire.rim);
    const spec = TIRE_SPECS[tire.id];

    // Only the first mock seller row per tire is used — every listing belongs to the single canonical seller account.
    const [sellerInput] = getSellersForTire(tire);
    if (!sellerInput) continue;

    await upsertListing({
      id: `seed-listing-${tire.id}`,
      productId: product.id,
      sellerId: seller.id,
      dot: tire.dot,
      loadIndex: spec?.loadIndex ?? "-",
      speedIndex: spec?.speedIndex ?? "-",
      ply: spec?.ply ?? "-",
      season: spec?.season ?? "-",
      productCode: spec?.productCode ?? tire.id.toUpperCase(),
      discountRate: sellerInput.discountRate,
      price: sellerInput.price,
      factoryPrice: normalFactoryPrice(tire.price, tire.discountRate),
      stock: sellerInput.stock,
      minOrder: sellerInput.minOrder,
      tag: tire.tag,
      adminId: admin.id,
    });
    listingCount += 1;
  }

  return listingCount;
}

function factorySpecFields(spec: string) {
  const [loadIndex = "-", speedIndex = "-", ply = "-", ...rest] = spec.split(" ");
  return {
    loadIndex,
    speedIndex,
    ply,
    season: rest.join(" ") || "-",
  };
}

async function seedFactoryTires(admin: SeedAdmin, seller: SeedSeller) {
  let listingCount = 0;

  for (const group of FACTORY_TIRES) {
    const product = await upsertProduct(
      group.manufacturer,
      group.model,
      group.width,
      group.ratio,
      group.rim,
    );
    const spec = factorySpecFields(group.spec);

    for (const row of group.rows) {
      // Factory rows have no seller in mockData, so use the same fallback seller
      // generator used by the existing catalog for a Tire without explicit sellers.
      const factoryTire: Tire = {
        id: group.id,
        manufacturer: group.manufacturer,
        model: group.model,
        width: group.width,
        ratio: group.ratio,
        rim: group.rim,
        dot: row.dot,
        discountRate: row.discountRate,
        price: row.price,
        tag: null,
        stock: row.stock,
      };

      // Only the first mock seller row is used — every listing belongs to the single canonical seller account.
      const [sellerInput] = getSellersForTire(factoryTire);
      if (!sellerInput) continue;

      await upsertListing({
        id: `seed-listing-${group.id}-${row.dot}`,
        productId: product.id,
        sellerId: seller.id,
        dot: row.dot,
        loadIndex: spec.loadIndex,
        speedIndex: spec.speedIndex,
        ply: spec.ply,
        season: spec.season,
        productCode: `${group.id}${row.dot}`.toUpperCase(),
        discountRate: sellerInput.discountRate,
        price: sellerInput.price,
        factoryPrice: group.factoryPrice,
        stock: sellerInput.stock,
        minOrder: sellerInput.minOrder,
        tag: null,
        adminId: admin.id,
      });
      listingCount += 1;
    }
  }

  return listingCount;
}

// Looks up the canonical admin/seller accounts an earlier run created, for a
// catalog-only run that intentionally skips demo user creation.
async function findCanonicalSeedTargets() {
  const [admin, seller] = await Promise.all([
    prisma.user.findUnique({ where: { loginId: "admin" } }),
    prisma.seller.findUnique({ where: { code: CANONICAL_SELLER_CODE } }),
  ]);
  return { admin, seller };
}

async function main() {
  const demoUsersRequested = process.env.SEED_DEMO_USERS === "true";
  if (demoUsersRequested && process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: SEED_DEMO_USERS=true is not allowed when NODE_ENV=production " +
        "because it creates buyer/seller/admin accounts under login IDs " +
        "(admin/buyer/seller) published in this repo's README.",
    );
  }

  const demoUsers = demoUsersRequested ? await createDemoUsers() : null;
  if (!demoUsersRequested) {
    console.log(
      "Skipped demo user creation (set SEED_DEMO_USERS=true to opt in; refused in production regardless).",
    );
  }

  // Catalog seeding attaches every listing to the canonical seller account, so
  // it needs that account (plus an admin id for the listing review audit
  // fields) to already exist — either created above this run, or from an
  // earlier run. Deliberately not falling back to creating them implicitly
  // here: a catalog-only run against a database with no canonical seller yet
  // should fail loudly instead of silently inventing one or attaching the
  // mock catalog to the wrong seller.
  const existing = demoUsers ? null : await findCanonicalSeedTargets();
  const admin = demoUsers?.admin ?? existing?.admin;
  const seller = demoUsers?.seller ?? existing?.seller;

  if (!admin || !seller) {
    throw new Error(
      "Cannot seed the tire catalog: no canonical admin/seller account found. " +
        "Run with SEED_DEMO_USERS=true (outside production) at least once first, " +
        "or run this against a database that already has one.",
    );
  }

  const tireListings = await seedTires(admin, seller);
  const factoryListings = await seedFactoryTires(admin, seller);

  const resetNonCanonicalRequested = process.env.SEED_RESET_NON_CANONICAL === "true";
  if (resetNonCanonicalRequested && process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: SEED_RESET_NON_CANONICAL=true is not allowed when NODE_ENV=production " +
        "because it deletes every non-canonical User (and their orders/cart/wishlist) from the database.",
    );
  }

  let removedUsers = 0;
  if (resetNonCanonicalRequested) {
    ({ removedUsers } = await removeNonCanonicalSeedData());
  } else {
    console.log(
      "Skipped non-canonical seed data cleanup (set SEED_RESET_NON_CANONICAL=true to opt in; refused in production regardless).",
    );
  }

  const [userCount, sellerCount, productCount, listingCount] = await Promise.all([
    prisma.user.count(),
    prisma.seller.count(),
    prisma.product.count(),
    prisma.listing.count(),
  ]);

  if (demoUsers) {
    console.log(`Seeded buyer: ${demoUsers.buyer.loginId}`);
    console.log(`Seeded admin: ${demoUsers.admin.loginId}`);
    console.log(`Seeded seller: seller (code ${CANONICAL_SELLER_CODE})`);
  } else {
    console.log(`Using existing admin (id ${admin.id}) and seller (code ${CANONICAL_SELLER_CODE}) for catalog seeding.`);
  }
  console.log(`Seeded tire listings: ${tireListings}`);
  console.log(`Seeded factory listings: ${factoryListings}`);
  console.log(`Removed non-canonical seed users: ${removedUsers}`);
  console.log(
    `Database totals — users: ${userCount}, sellers: ${sellerCount}, products: ${productCount}, listings: ${listingCount}`,
  );
  console.log("Legacy GOODS/EVENTS/NOTICES remain in src/lib/mockData.ts because the schema has no corresponding models.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
