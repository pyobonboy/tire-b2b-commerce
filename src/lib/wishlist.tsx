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
import type { WishSeller } from "./types";

interface WishlistContextValue {
  sellers: WishSeller[];
  loading: boolean;
  isWished: (code: string) => boolean;
  toggleWish: (seller: Omit<WishSeller, "wishedAt">) => Promise<void>;
  removeWish: (id: string) => Promise<void>;
  refreshWishlist: () => Promise<WishSeller[]>;
}

interface WishlistResponse {
  sellers?: WishSeller[];
  wished?: boolean;
  seller?: WishSeller | null;
  error?: string;
}

export class WishlistRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "WishlistRequestError";
  }
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

async function readWishlistResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as WishlistResponse | null;
  if (!response.ok) throw new WishlistRequestError(body?.error ?? "WISHLIST_REQUEST_FAILED");
  return body;
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const [sellers, setSellers] = useState<WishSeller[]>([]);
  const [sellersOwnerId, setSellersOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshWishlist = useCallback(async () => {
    const response = await fetch("/api/wishlist", { cache: "no-store" });
    const body = await readWishlistResponse(response);
    const nextSellers = body?.sellers ?? [];
    setSellers(nextSellers);
    setSellersOwnerId(userId ?? null);
    return nextSellers;
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    if (!userId) {
      return () => {
        cancelled = true;
      };
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the session with the external wishlist API
    void refreshWishlist()
      .catch(() => {
        if (!cancelled) setSellers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, refreshWishlist, userId]);

  const toggleWish = useCallback(async (seller: Omit<WishSeller, "wishedAt">) => {
    const response = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seller),
    });
    const body = await readWishlistResponse(response);
    setSellersOwnerId(userId ?? null);
    if (body?.wished && body.seller) {
      setSellers((current) => [body.seller!, ...current.filter((item) => item.code !== seller.code)]);
    } else {
      setSellers((current) => current.filter((item) => item.code !== seller.code));
    }
  }, [userId]);

  const removeWish = useCallback(async (id: string) => {
    const response = await fetch(`/api/wishlist/${encodeURIComponent(id)}`, { method: "DELETE" });
    await readWishlistResponse(response);
    setSellers((current) => current.filter((seller) => seller.id !== id));
  }, []);

  const visibleSellers = sellersOwnerId === userId && Boolean(userId) ? sellers : [];

  return (
    <WishlistContext.Provider
      value={{
        sellers: visibleSellers,
        loading: authLoading || (userId ? loading || sellersOwnerId !== userId : false),
        isWished: (code) => visibleSellers.some((seller) => seller.code === code),
        toggleWish,
        removeWish,
        refreshWishlist,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
