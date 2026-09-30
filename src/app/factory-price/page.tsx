"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchX } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { CATALOG, MANUFACTURERS } from "@/lib/mockData";

type SortKey = "popular" | "lowest" | "highest";

function FactoryPriceContent() {
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [size, setSize] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  function toggleManufacturer(m: string) {
    setManufacturers((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  const rows = useMemo(() => {
    const sizeParts = size.trim().split(/\s+/).filter(Boolean).map(Number);
    const filtered = CATALOG.filter((r) => {
      if (manufacturers.length > 0 && !manufacturers.includes(r.manufacturer)) return false;
      if (inStockOnly && r.stock === 0) return false;
      if (sizeParts.length >= 1 && !Number.isNaN(sizeParts[0]) && r.width !== sizeParts[0])
        return false;
      if (sizeParts.length >= 2 && !Number.isNaN(sizeParts[1]) && r.ratio !== sizeParts[1])
        return false;
      if (sizeParts.length >= 3 && !Number.isNaN(sizeParts[2]) && r.rim !== sizeParts[2])
        return false;
      return true;
    });
    const copy = [...filtered];
    // CatalogRow's price/stock fields are `number | null` because the real
    // /api/products response nulls them for guests (see SECURITY BOUNDARY
    // comment in src/lib/server/products.ts) — but this page only ever reads
    // CATALOG, the hardcoded mock data (never null), and is itself wrapped in
    // RequireAuth below. The assertions here just satisfy the shared type.
    if (sort === "lowest") copy.sort((a, b) => a.lowPrice! - b.lowPrice!);
    else if (sort === "highest") copy.sort((a, b) => b.highPrice! - a.highPrice!);
    else copy.sort((a, b) => b.registeredOrder - a.registeredOrder);
    return copy;
  }, [manufacturers, inStockOnly, size, sort]);

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-1">공장도가 확인</h1>
      <p className="text-sm text-muted mb-5">타이어의 공장도가를 손쉽게 확인하세요!</p>

      <div className="card p-4 mb-3 flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground/70 mb-2">제조사</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {MANUFACTURERS.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={manufacturers.includes(m)}
                  onChange={() => toggleManufacturer(m)}
                  className="w-4 h-4"
                />
                {m}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="사이즈 입력 예) 2454518"
            className="h-10 px-3 rounded-lg border border-border text-sm w-56 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="w-4 h-4"
            />
            재고 있는 상품만
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{rows.length}</b>개의 상품
        </p>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setSort("popular")}
            className={`font-medium ${sort === "popular" ? "text-brand" : "text-muted hover:text-foreground"}`}
          >
            판매인기순
          </button>
          <button
            onClick={() => setSort("lowest")}
            className={`font-medium ${sort === "lowest" ? "text-brand" : "text-muted hover:text-foreground"}`}
          >
            공장도가 최저가순
          </button>
          <button
            onClick={() => setSort("highest")}
            className={`font-medium ${sort === "highest" ? "text-brand" : "text-muted hover:text-foreground"}`}
          >
            공장도가 최고가순
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-center text-muted py-16 text-sm">
          <SearchX size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          조건에 맞는 상품이 없습니다.
        </div>
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto card">
            <table className="min-w-[960px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-3 px-4 font-medium">제조사</th>
                  <th className="py-3 px-4 font-medium">제품정보</th>
                  <th className="py-3 px-4 font-medium">사이즈</th>
                  <th className="py-3 px-4 font-medium">세부정보</th>
                  <th className="py-3 px-4 font-medium">제품번호</th>
                  <th className="py-3 px-4 font-medium">생산년도</th>
                  <th className="py-3 px-4 font-medium">공장도가</th>
                  <th className="py-3 px-4 font-medium">최저가</th>
                  <th className="py-3 px-4 font-medium">최고가</th>
                  <th className="py-3 px-4 font-medium">재고수량</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="py-3 px-4">{r.manufacturer}</td>
                    <td className="py-3 px-4">
                      <Link
                        href={`/products/${r.detailId}${r.detailDot ? `?dot=${r.detailDot}` : ""}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {r.model}
                      </Link>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {r.width} / {r.ratio} R {r.rim}
                    </td>
                    <td className="py-3 px-4 text-muted">{r.spec}</td>
                    <td className="py-3 px-4 text-muted">{r.productCode}</td>
                    <td className="py-3 px-4 text-muted">{r.dot}</td>
                    <td className="py-3 px-4 tabular-nums font-bold">
                      {r.factoryPrice!.toLocaleString()}원
                    </td>
                    <td className="py-3 px-4 tabular-nums text-brand font-bold">
                      {r.lowPrice!.toLocaleString()}원
                    </td>
                    <td className="py-3 px-4 tabular-nums">{r.highPrice!.toLocaleString()}원</td>
                    <td className="py-3 px-4 tabular-nums">
                      {r.stock === 0 ? (
                        <span className="text-muted">품절</span>
                      ) : (
                        r.stock!.toLocaleString()
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden flex flex-col gap-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/products/${r.detailId}${r.detailDot ? `?dot=${r.detailDot}` : ""}`}
                className="card p-4 block"
              >
                <p className="text-xs text-muted mb-0.5">
                  {r.manufacturer} · {r.spec}
                </p>
                <p className="font-semibold">{r.model}</p>
                <p className="text-xs text-muted mt-1">
                  {r.width} / {r.ratio} R {r.rim} · DOT {r.dot}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted">
                    공장도가 {r.factoryPrice!.toLocaleString()}원
                  </span>
                  <span className="font-extrabold text-brand tabular-nums">
                    {r.lowPrice!.toLocaleString()}원
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function FactoryPricePage() {
  return (
    <RequireAuth>
      <FactoryPriceContent />
    </RequireAuth>
  );
}
