"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bell,
  ChevronRight,
  CircleDot,
  Heart,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  Truck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { MYPAGE_LINKS, SIDEBAR_LINKS } from "@/lib/nav";

const SIDEBAR_ICONS: Record<string, LucideIcon> = {
  "/events?tab=ongoing": Bell,
  "/exhibition": Sparkles,
  "/factory-price": Star,
  "/products": CircleDot,
  "/direct": Truck,
  "/products?tag=EVENT": Tag,
  "/wishlist": Heart,
  "/cart": ShoppingCart,
};

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mypageOpen, setMypageOpen] = useState(true);

  const activeHref = useMemo(() => {
    let bestHref: string | null = null;
    let bestSpecificity = -1;

    for (const link of SIDEBAR_LINKS) {
      const [linkPath, queryString] = link.href.split("?");
      if (pathname !== linkPath) continue;

      const linkParams = new URLSearchParams(queryString ?? "");
      const specificity = Array.from(linkParams.keys()).length;

      const matches = Array.from(linkParams.entries()).every(
        ([key, value]) => searchParams.get(key) === value
      );
      if (!matches) continue;

      if (specificity > bestSpecificity) {
        bestSpecificity = specificity;
        bestHref = link.href;
      }
    }

    return bestHref;
  }, [pathname, searchParams]);

  return (
    <aside className="sticky top-[71px] hidden h-[calc(100vh-71px)] w-[224px] shrink-0 self-start flex-col overflow-y-auto border-r border-[#e7eaf0] bg-white lg:flex">
      <div className="flex flex-col px-3 py-4">
        {SIDEBAR_LINKS.map((link) => {
          const active = link.href === activeHref;
          const Icon = SIDEBAR_ICONS[link.href] ?? CircleDot;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex h-[44px] items-center gap-2.5 rounded-xl px-3.5 text-[14px] font-medium ${
                active
                  ? "bg-blue-50/80 font-semibold text-brand before:absolute before:left-0 before:h-5 before:w-[3px] before:rounded-r-full before:bg-brand"
                  : "text-[#3c424a] hover:bg-[#f7f9fc] hover:text-brand"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.7} />
              {link.label}
            </Link>
          );
        })}

        <button
          onClick={() => setMypageOpen((v) => !v)}
          aria-expanded={mypageOpen}
          className="mt-1 flex h-[44px] items-center justify-between rounded-xl px-3.5 text-[14px] font-semibold text-foreground hover:bg-[#f7f9fc] hover:text-brand"
        >
          <span className="flex items-center gap-2.5">
            <UserRound size={19} strokeWidth={1.8} />
            마이페이지
          </span>
          <ChevronRight
            size={15}
            className={`transition-transform ${mypageOpen ? "rotate-90" : ""}`}
          />
        </button>
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            mypageOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="ml-[22px] border-l border-[#d8dde5] py-1">
              {MYPAGE_LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`relative block rounded-r-lg px-4 py-2 text-[12px] ${
                      active ? "text-brand font-semibold" : "text-[#666] hover:text-brand"
                    }`}
                  >
                    <span className="absolute left-0 top-1/2 w-2.5 border-t border-[#cfd4dc]" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Link
        href="/events?tab=ongoing"
        className="relative mx-4 mb-4 mt-auto block h-[102px] overflow-hidden rounded-xl border border-[#eceff3] shadow-[0_8px_22px_-18px_rgba(15,23,42,0.5)]"
      >
        <Image
          src="/banners/continental-big-sale.jpg"
          alt="진행중 이벤트"
          fill
          sizes="200px"
          className="object-cover"
        />
      </Link>
    </aside>
  );
}
