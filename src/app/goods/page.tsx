"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageSearch, Search } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import ImagePlaceholder from "@/components/ImagePlaceholder";
import { GOODS_CATEGORIES } from "@/lib/nav";
import { GOODS } from "@/lib/mockData";
import type { GoodsItem } from "@/lib/types";

type SortKey = "popular" | "lowest" | "highest" | "name" | "recent";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "판매인기순" },
  { key: "lowest", label: "최저가순" },
  { key: "highest", label: "최고가순" },
  { key: "name", label: "상품명순" },
  { key: "recent", label: "최근등록순" },
];

function GoodsCard({ item }: { item: GoodsItem }) {
  return (
    <div className="card p-3 flex flex-col gap-1.5">
      <ImagePlaceholder className="w-full aspect-square mb-1" />
      <span className="text-xs text-muted">{item.brand}</span>
      <p className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.5em]">{item.name}</p>
      {item.freeShipping && (
        <span className="w-fit text-[10px] font-semibold text-brand border border-brand rounded px-1.5 py-0.5">
          무료배송
        </span>
      )}
      <div className="mt-auto pt-1.5 flex items-center gap-1.5 tabular-nums">
        <span className="text-sm font-extrabold text-accent">{item.discountRate}%</span>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] text-muted line-through">
            {item.originalPrice.toLocaleString()}원
          </span>
          <span className="font-extrabold text-sm">{item.price.toLocaleString()}원</span>
        </div>
      </div>
    </div>
  );
}

function GoodsContent() {
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? "오일";
  const [query, setQuery] = useState("");
  const [excludeSoldOut, setExcludeSoldOut] = useState(false);
  const [sort, setSort] = useState<SortKey>("popular");

  const items = useMemo(() => {
    const filtered = GOODS.filter((g) => g.category === category).filter(
      (g) => !query || g.name.toLowerCase().includes(query.toLowerCase())
    );
    // demo data has no soldOut flag yet; the checkbox is wired for parity with the real UI
    void excludeSoldOut;
    const copy = [...filtered];
    if (sort === "lowest") copy.sort((a, b) => a.price - b.price);
    else if (sort === "highest") copy.sort((a, b) => b.price - a.price);
    else if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    else if (sort === "recent") copy.sort((a, b) => b.id.localeCompare(a.id));
    return copy;
  }, [category, query, excludeSoldOut, sort]);

  return (
    <div className="px-4 py-5 max-w-[1680px] mx-auto flex gap-6">
      <aside className="hidden lg:flex w-48 shrink-0 flex-col gap-1 py-1">
        <p className="px-3 pb-2 text-xs font-semibold text-muted">정비용품 구매</p>
        {GOODS_CATEGORIES.map((c) => {
          const active = c.label === category;
          return (
            <Link
              key={c.href}
              href={c.href}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                active ? "bg-brand/10 text-brand" : "text-foreground/80 hover:bg-surface-2"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex lg:hidden gap-2 overflow-x-auto pb-3 mb-2 -mx-4 px-4">
          {GOODS_CATEGORIES.map((c) => {
            const active = c.label === category;
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  active
                    ? "bg-brand text-white border-brand"
                    : "border-border text-foreground/70"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>

        <h1 className="text-xl font-extrabold mb-3">{category}</h1>

        <div className="card p-3 mb-4 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted shrink-0">
            <input
              type="checkbox"
              checked={excludeSoldOut}
              onChange={(e) => setExcludeSoldOut(e.target.checked)}
              className="w-4 h-4"
            />
            품절 제외
          </label>
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="상품명, 검색키워드 검색"
              className="h-9 pl-9 pr-3 rounded-lg border border-border text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-sm text-muted">
            총 <b className="text-foreground">{items.length}</b>개 상품
          </p>
          <div className="flex items-center gap-3 text-xs">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`font-medium ${sort === s.key ? "text-brand" : "text-muted hover:text-foreground"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="card text-center text-muted py-16 text-sm">
            <PackageSearch size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
            준비 중인 카테고리입니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((item) => (
              <GoodsCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GoodsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState />}>
        <GoodsContent />
      </Suspense>
    </RequireAuth>
  );
}
