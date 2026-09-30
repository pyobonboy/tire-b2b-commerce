"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./auth";
import type { MyListing, Manufacturer } from "./types";
import type { SellerListingView, SellerListingStatus } from "./seller-types";

interface NewListingInput {
  manufacturer: Manufacturer;
  model: string;
  width: number;
  ratio: number;
  rim: number;
  dot: string;
  price: number;
  stock: number;
}

interface ListingsContextValue {
  listings: MyListing[];
  loading: boolean;
  addListing: (listing: NewListingInput) => Promise<void>;
  removeListing: (id: string) => Promise<void>;
  toggleStatus: (id: string) => Promise<void>;
  refreshListings: () => Promise<MyListing[]>;
}

interface ListingsResponse {
  listings?: SellerListingView[];
  listing?: SellerListingView;
  error?: string;
}

export class ListingsRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ListingsRequestError";
  }
}

const ListingsContext = createContext<ListingsContextValue | null>(null);

const statusLabels: Record<SellerListingStatus, MyListing["status"]> = {
  DRAFT: "작성중",
  PENDING: "승인대기",
  ACTIVE: "판매중",
  REJECTED: "반려",
  SOLDOUT: "품절",
  HIDDEN: "비노출",
};

function toMyListing(listing: SellerListingView): MyListing {
  return {
    id: listing.id,
    manufacturer: listing.manufacturer as Manufacturer,
    model: listing.model,
    width: listing.width,
    ratio: listing.ratio,
    rim: listing.rim,
    dot: listing.dot,
    price: listing.price,
    stock: listing.stock,
    status: statusLabels[listing.status],
    registeredAt: listing.createdAt.slice(0, 10),
  };
}

async function readListingsResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as ListingsResponse | null;
  if (!response.ok) throw new ListingsRequestError(body?.error ?? "LISTINGS_REQUEST_FAILED");
  return body;
}

export function ListingsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const userRole = user?.role;
  const [listings, setListings] = useState<MyListing[]>([]);
  const [listingsOwnerId, setListingsOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshListings = useCallback(async () => {
    const response = await fetch("/api/seller/listings", { cache: "no-store" });
    const body = await readListingsResponse(response);
    const nextListings = (body?.listings ?? []).map(toMyListing);
    setListings(nextListings);
    setListingsOwnerId(userId ?? null);
    return nextListings;
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    if (!userId || userRole !== "SELLER") {
      return () => {
        cancelled = true;
      };
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the session with the external listing API
    void refreshListings()
      .catch(() => {
        if (!cancelled) setListings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, refreshListings, userId, userRole]);

  const addListing = useCallback(async (listing: NewListingInput) => {
    const response = await fetch("/api/seller/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...listing,
        loadIndex: "-",
        speedIndex: "-",
        ply: "-",
        oe: null,
        season: "사계절",
        productCode: `LEGACY-${Date.now()}`,
        discountRate: 0,
        factoryPrice: listing.price,
        minOrder: 1,
        tag: null,
        courier: "택배",
        shippingNote: null,
      }),
    });
    const body = await readListingsResponse(response);
    if (!body?.listing) throw new ListingsRequestError("LISTING_RESPONSE_INVALID");
    const saved = toMyListing(body.listing);
    setListingsOwnerId(userId ?? null);
    setListings((current) => [saved, ...current]);
  }, [userId]);

  const removeListing = useCallback(async (id: string) => {
    const response = await fetch(`/api/seller/listings/${encodeURIComponent(id)}`, { method: "DELETE" });
    await readListingsResponse(response);
    setListings((current) => current.filter((listing) => listing.id !== id));
  }, []);

  const toggleStatus = useCallback(async (id: string) => {
    const current = listings.find((listing) => listing.id === id);
    if (!current) throw new ListingsRequestError("LISTING_NOT_FOUND");
    const response =
      current.status === statusLabels.DRAFT || current.status === statusLabels.REJECTED
        ? await fetch(`/api/seller/listings/${encodeURIComponent(id)}/submit`, { method: "POST" })
        : await fetch(`/api/seller/listings/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stock:
                current.status === statusLabels.ACTIVE ? 0 : Math.max(current.stock, 1),
            }),
          });
    const body = await readListingsResponse(response);
    if (!body?.listing) throw new ListingsRequestError("LISTING_RESPONSE_INVALID");
    const updated = toMyListing(body.listing);
    setListings((currentListings) =>
      currentListings.map((listing) => (listing.id === updated.id ? updated : listing)),
    );
  }, [listings]);

  const visibleListings = listingsOwnerId === userId && userRole === "SELLER" ? listings : [];

  return (
    <ListingsContext.Provider
      value={{
        listings: visibleListings,
        loading: authLoading || (userRole === "SELLER" ? loading || listingsOwnerId !== userId : false),
        addListing,
        removeListing,
        toggleStatus,
        refreshListings,
      }}
    >
      {children}
    </ListingsContext.Provider>
  );
}

export function useListings() {
  const ctx = useContext(ListingsContext);
  if (!ctx) throw new Error("useListings must be used within ListingsProvider");
  return ctx;
}
