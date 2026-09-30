"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Factory,
  Headphones,
  Home,
  LogIn,
  PackageSearch,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";

const MEMBER_ITEMS = [
  { href: "/main", label: "홈", Icon: Home, paths: ["/main"] },
  { href: "/factory-price", label: "공장도가", Icon: Factory, paths: ["/factory-price"] },
  {
    href: "/products",
    label: "상품목록",
    Icon: PackageSearch,
    paths: ["/products", "/direct", "/events", "/exhibition"],
  },
  { href: "/cart", label: "장바구니", Icon: ShoppingCart, paths: ["/cart"] },
  {
    href: "/mypage/status",
    label: "마이",
    Icon: UserRound,
    paths: ["/mypage", "/orders", "/wishlist"],
  },
];

const GUEST_ITEMS = [
  { href: "/main", label: "홈", Icon: Home, paths: ["/main"] },
  { href: "/products", label: "상품목록", Icon: PackageSearch, paths: ["/products"] },
  { href: "/events?tab=ongoing", label: "이벤트", Icon: CalendarDays, paths: ["/events"] },
  { href: "/customer?tab=faq", label: "고객센터", Icon: Headphones, paths: ["/customer"] },
  { href: "/login?redirect=/main", label: "로그인", Icon: LogIn, paths: ["/login"] },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { items } = useCart();
  const cartCount = items.reduce((total, item) => total + item.quantity, 0);
  const navItems = user ? MEMBER_ITEMS : GUEST_ITEMS;

  return (
    <nav
      aria-label="모바일 주요 메뉴"
      className="fixed inset-x-3 bottom-2 z-40 grid h-[62px] grid-cols-5 overflow-hidden rounded-[20px] border border-[#e7eaf0]/90 bg-white/92 pb-[env(safe-area-inset-bottom)] shadow-[0_10px_28px_-12px_rgba(15,23,42,0.22)] backdrop-blur-2xl lg:hidden"
    >
      {navItems.map(({ href, label, Icon, paths }) => {
        const active = paths.some((path) =>
          path === "/main" || path === "/cart"
            ? pathname === path
            : pathname === path || pathname.startsWith(`${path}/`),
        );

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] transition-transform duration-200 active:scale-95 ${
              active ? "font-bold text-brand" : "text-[#727780]"
            }`}
          >
            {active && <span className="absolute top-0 h-[2px] w-7 rounded-b-full bg-brand" />}
            <span
              className={`relative flex h-8 w-10 items-center justify-center rounded-xl transition-all duration-300 ${
                active ? "bg-blue-50" : ""
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
              {href === "/cart" && cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold leading-none text-white shadow-sm">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
