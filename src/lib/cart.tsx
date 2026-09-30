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
import type { CartItem } from "./types";

interface CartContextValue {
  items: CartItem[];
  loading: boolean;
  addItem: (item: Omit<CartItem, "id">) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  clear: () => Promise<void>;
  refreshCart: () => Promise<CartItem[]>;
}

interface CartResponse {
  items?: CartItem[];
  item?: CartItem;
  error?: string;
}

export class CartRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CartRequestError";
  }
}

const CartContext = createContext<CartContextValue | null>(null);

async function readCartResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as CartResponse | null;
  if (!response.ok) throw new CartRequestError(body?.error ?? "CART_REQUEST_FAILED");
  return body;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id;
  const userRole = user?.role;
  const [items, setItems] = useState<CartItem[]>([]);
  const [itemsOwnerId, setItemsOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshCart = useCallback(async () => {
    const response = await fetch("/api/cart", { cache: "no-store" });
    const body = await readCartResponse(response);
    const nextItems = body?.items ?? [];
    setItems(nextItems);
    setItemsOwnerId(userId ?? null);
    return nextItems;
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    if (!userId || userRole !== "BUYER") {
      return () => {
        cancelled = true;
      };
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the session with the external cart API
    void refreshCart()
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, refreshCart, userId, userRole]);

  const addItem = useCallback(async (item: Omit<CartItem, "id">) => {
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    const body = await readCartResponse(response);
    if (!body?.item) throw new CartRequestError("CART_RESPONSE_INVALID");
    const savedItem = body.item;
    setItemsOwnerId(userId ?? null);
    setItems((current) => {
      const existing = current.find(
        (currentItem) =>
          currentItem.tireId === savedItem.tireId &&
          currentItem.sellerCode === savedItem.sellerCode &&
          currentItem.dot === savedItem.dot,
      );
      return existing
        ? current.map((currentItem) => (currentItem.id === existing.id ? savedItem : currentItem))
        : [...current, savedItem];
    });
  }, [userId]);

  const removeItem = useCallback(async (id: string) => {
    const response = await fetch(`/api/cart/${encodeURIComponent(id)}`, { method: "DELETE" });
    await readCartResponse(response);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const updateQuantity = useCallback(async (id: string, quantity: number) => {
    const response = await fetch(`/api/cart/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: Math.max(1, quantity) }),
    });
    const body = await readCartResponse(response);
    if (!body?.item) throw new CartRequestError("CART_RESPONSE_INVALID");
    setItems((current) =>
      current.map((item) => (item.id === body.item?.id ? body.item : item)),
    );
  }, []);

  const clear = useCallback(async () => {
    const response = await fetch("/api/cart", { method: "DELETE" });
    await readCartResponse(response);
    setItems([]);
  }, []);

  const visibleItems = itemsOwnerId === userId && userRole === "BUYER" ? items : [];

  return (
    <CartContext.Provider
      value={{
        items: visibleItems,
        loading: authLoading || (userRole === "BUYER" ? loading || itemsOwnerId !== userId : false),
        addItem,
        removeItem,
        updateQuantity,
        clear,
        refreshCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
