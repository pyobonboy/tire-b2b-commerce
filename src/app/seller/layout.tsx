"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";

const navigation = [
  { href: "/seller", label: "대시보드" },
  { href: "/seller/listings", label: "내 상품" },
  { href: "/seller/orders", label: "주문 관리" },
  { href: "/seller/returns", label: "교환/반품 관리" },
  { href: "/seller/settlements", label: "정산" },
];

function isActive(pathname: string, href: string) {
  return href === "/seller" ? pathname === href : pathname.startsWith(href);
}

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/seller/signup" || pathname.startsWith("/seller/signup/")) {
    return <>{children}</>;
  }

  return (
    <RequireAuth allow={["SELLER"]}>
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-160px)]">
        <aside className="hidden lg:block w-56 shrink-0 border-r border-border bg-surface-2/50 p-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wider px-3 py-2">
            판매자 센터
          </p>
          <nav className="flex flex-col gap-1 mt-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(pathname, item.href)
                    ? "bg-brand text-white"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-border mt-6 pt-4 px-3">
            <p className="text-xs text-muted leading-relaxed">
              상품을 등록한 뒤 승인 요청을 보내면 본사 검토 후 판매가 시작됩니다.
            </p>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <nav className="lg:hidden flex gap-1 overflow-x-auto border-b border-border px-4 py-2 bg-surface-2/50">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(pathname, item.href)
                    ? "bg-brand text-white"
                    : "text-muted hover:bg-surface-2"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </div>
    </RequireAuth>
  );
}
