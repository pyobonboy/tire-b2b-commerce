"use client";

import { SessionProvider } from "next-auth/react";
import DialogProvider from "@/components/ui/DialogProvider";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { ListingsProvider } from "@/lib/listings";
import { OrdersProvider } from "@/lib/orders";
import { WishlistProvider } from "@/lib/wishlist";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <OrdersProvider>
          <WishlistProvider>
            <CartProvider>
              <ListingsProvider>
                {/* 브라우저 기본 confirm/prompt/alert 를 대체하는 공용 대화상자.
                    모든 화면에서 useDialogs() 로 접근한다. */}
                <DialogProvider>{children}</DialogProvider>
              </ListingsProvider>
            </CartProvider>
          </WishlistProvider>
        </OrdersProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
