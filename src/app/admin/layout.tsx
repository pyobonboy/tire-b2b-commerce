"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";

const navigation = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/buyers", label: "구매자 관리" },
  { href: "/admin/sellers", label: "판매자 관리" },
  { href: "/admin/listings", label: "상품 심사" },
  { href: "/admin/orders", label: "전체 주문" },
  { href: "/admin/returns", label: "교환/반품 관리" },
  { href: "/admin/tax-invoices", label: "세금계산서 관리" },
  { href: "/admin/settlements", label: "정산 관리" },
  { href: "/admin/inquiries", label: "1:1 문의" },
  { href: "/admin/events", label: "공지·이벤트" },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <RequireAuth allow={["ADMIN"]}>
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-160px)]">
        <aside className="hidden lg:block w-56 shrink-0 border-r border-border bg-surface-2/50 p-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wider px-3 py-2">
            본사 관리자
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
              판매자 승인과 상품 게시 상태를 검토하고 배송 분쟁을 관리합니다.
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
