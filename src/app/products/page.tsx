"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { MANUFACTURERS } from "@/lib/mockData";
import type { CatalogRow } from "@/lib/types";
import { useAuth } from "@/lib/auth";

type SortKey = "registered" | "popular" | "lowest" | "highest" | "discount";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "registered", label: "등록일순" },
  { key: "popular", label: "인기판매순" },
  { key: "lowest", label: "최저가순" },
  { key: "highest", label: "최고가순" },
  { key: "discount", label: "DC율 높은순" },
];

// Kept in sync with PAGE_SIZE in src/app/api/products/route.ts — this is
// only used here to turn the server-reported `total` into a page count.
const PAGE_SIZE = 12;

// Debounces a value so text-input filters don't fire a request on every
// keystroke. Mirrors the previous instant client-side filtering closely
// enough (short delay) while keeping the request volume bounded.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function ProductsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const tag = searchParams.get("tag");

  const [size, setSize] = useState(searchParams.get("size") ?? "");
  const [manufacturer, setManufacturer] = useState(searchParams.get("manufacturer") ?? "");
  const [model, setModel] = useState("");
  const [productCode, setProductCode] = useState("");
  const [width, setWidth] = useState("");
  const [ratio, setRatio] = useState("");
  const [rim, setRim] = useState("");
  const [dot, setDot] = useState("");
  const [sort, setSort] = useState<SortKey>("registered");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const debouncedSize = useDebouncedValue(size, 350);
  const debouncedModel = useDebouncedValue(model, 350);
  const debouncedProductCode = useDebouncedValue(productCode, 350);
  const debouncedWidth = useDebouncedValue(width, 350);
  const debouncedRatio = useDebouncedValue(ratio, 350);
  const debouncedRim = useDebouncedValue(rim, 350);
  const debouncedDot = useDebouncedValue(dot, 350);

  // Reset to page 1 whenever a filter or sort actually changes (i.e. once
  // the debounced value settles), not on every keystroke. This follows
  // React's "adjust state during render" pattern instead of an effect:
  // setPage is called directly in the render body, guarded by comparing
  // against the previous filtersKey, so React re-renders with page reset to
  // 1 before anything commits or fetches — no extra render/fetch cycle.
  const filtersKey = JSON.stringify([
    debouncedSize,
    manufacturer,
    debouncedModel,
    debouncedProductCode,
    debouncedWidth,
    debouncedRatio,
    debouncedRim,
    debouncedDot,
    tag,
    sort,
  ]);
  const [appliedFiltersKey, setAppliedFiltersKey] = useState(filtersKey);
  if (filtersKey !== appliedFiltersKey) {
    setAppliedFiltersKey(filtersKey);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;

    const query = new URLSearchParams();
    if (debouncedSize) query.set("size", debouncedSize);
    if (manufacturer) query.set("manufacturer", manufacturer);
    if (debouncedModel) query.set("model", debouncedModel);
    if (debouncedProductCode) query.set("productCode", debouncedProductCode);
    if (debouncedWidth) query.set("width", debouncedWidth);
    if (debouncedRatio) query.set("ratio", debouncedRatio);
    if (debouncedRim) query.set("rim", debouncedRim);
    if (debouncedDot) query.set("dot", debouncedDot);
    if (tag) query.set("tag", tag);
    query.set("sort", sort);
    query.set("page", String(page));

    fetch(`/api/products?${query.toString()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ products: CatalogRow[]; total: number }>;
      })
      .then((data) => {
        if (cancelled) return;
        setRows(data.products);
        setTotal(data.total);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    debouncedSize,
    manufacturer,
    debouncedModel,
    debouncedProductCode,
    debouncedWidth,
    debouncedRatio,
    debouncedRim,
    debouncedDot,
    tag,
    sort,
    page,
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading && rows.length === 0 && !loadError) return <LoadingState />;

  if (loadError) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">상품 목록을 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-4">
        {tag === "EVENT" ? "이벤트 상품목록" : "일반 상품목록"}
      </h1>

      <div className="card p-4 mb-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="사이즈 검색 예) 245 45 18"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand col-span-2 sm:col-span-1"
          />
          <Select
            value={manufacturer}
            onValueChange={setManufacturer}
            items={[
              { value: "", label: "제조사" },
              ...MANUFACTURERS.map((m) => ({ value: m, label: m })),
            ]}
            ariaLabel="제조사"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="제품명"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <input
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            placeholder="제품번호(형용코드)"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="단면폭"
            inputMode="numeric"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <input
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            placeholder="편평비"
            inputMode="numeric"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <input
            value={rim}
            onChange={(e) => setRim(e.target.value)}
            placeholder="인치"
            inputMode="numeric"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <input
            value={dot}
            onChange={(e) => setDot(e.target.value)}
            placeholder="DOT 예) 2025"
            className="h-10 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{total}</b>개 상품
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

      {rows.length === 0 ? (
        <div className="card text-center text-muted py-16 text-sm">
          <SearchX size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          조건에 맞는 타이어가 없습니다.
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
                    <td className="py-3 px-4 tabular-nums text-muted">
                      {/* user 가 true 면 서버가 includeSensitive:true 로 응답했으므로
                          이 필드들은 null 일 수 없다 — 타입만 number | null (see
                          src/lib/types.ts CatalogRow) 이라 단언이 필요하다. */}
                      {user ? `${r.factoryPrice!.toLocaleString()}원` : "로그인 후 공개"}
                    </td>
                    <td className="py-3 px-4 tabular-nums font-bold text-brand">
                      {user ? `${r.lowPrice!.toLocaleString()}원` : "로그인 후 공개"}
                    </td>
                    <td className="py-3 px-4 tabular-nums">
                      {user ? `${r.highPrice!.toLocaleString()}원` : "로그인 후 공개"}
                    </td>
                    <td className="py-3 px-4 tabular-nums">
                      {user ? r.stock!.toLocaleString() : "로그인 후 공개"}
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
                <p className="text-xs text-muted mb-0.5">{r.manufacturer}</p>
                <p className="font-semibold">{r.model}</p>
                <p className="text-xs text-muted mt-1">
                  {r.width} / {r.ratio} R {r.rim} · DOT {r.dot}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted">
                    {user ? `재고 ${r.stock}` : "재고 로그인 후 공개"}
                  </span>
                  <span className="font-extrabold text-brand tabular-nums">
                    {user ? `${r.lowPrice!.toLocaleString()}원` : "로그인 후 가격 확인"}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-6">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium ${
                    p === page ? "bg-brand text-white" : "text-muted hover:bg-surface-2"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ProductsContent />
    </Suspense>
  );
}
