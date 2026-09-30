"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { SellerListingStatus, SellerListingView } from "@/lib/seller-types";
import { formatDay } from "@/lib/formatDate";

const statusLabels: Record<SellerListingStatus, string> = {
  DRAFT: "작성중",
  PENDING: "승인 대기",
  ACTIVE: "판매중",
  REJECTED: "반려",
  SOLDOUT: "품절",
  HIDDEN: "비노출",
};


export default function SellerListingsPage() {
  const { confirm: confirmDialog } = useDialogs();
  const [status, setStatus] = useState("");
  const [listings, setListings] = useState<SellerListingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";

    fetch(`/api/seller/listings${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ listings: SellerListingView[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setListings(data.listings);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  async function handleDelete(id: string) {
    if (!(await confirmDialog({ title: "작성중인 상품을 삭제하시겠습니까?", destructive: true }))) return;
    const response = await fetch(`/api/seller/listings/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("상품을 삭제하지 못했습니다. 작성중 상태인지 확인해 주세요.");
      return;
    }
    setListings((current) => current.filter((listing) => listing.id !== id));
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-extrabold">내 상품</h1>
          <p className="text-sm text-muted mt-1">상품 정보를 관리하고 본사 승인 상태를 확인하세요.</p>
        </div>
        <Link href="/seller/listings/new" className="btn-primary shrink-0">
          새 상품 등록
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{listings.length}</b>건
        </p>
        <Select
          value={status}
          onValueChange={setStatus}
          items={[
            { value: "", label: "전체 상태" },
            { value: "DRAFT", label: "작성중" },
            { value: "PENDING", label: "승인 대기" },
            { value: "ACTIVE", label: "판매중" },
            { value: "REJECTED", label: "반려" },
            { value: "SOLDOUT", label: "품절" },
            { value: "HIDDEN", label: "비노출" },
          ]}
          className="h-10 px-3 rounded-lg border border-border text-sm bg-background"
          ariaLabel="상품 상태 필터"
        />
      </div>

      {error && <p className="text-sm text-accent mb-3">{error}</p>}

      {listings.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">
          조건에 맞는 상품이 없습니다.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[950px] w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-3 px-4 font-medium">상품</th>
                <th className="py-3 px-4 font-medium">규격 / DOT</th>
                <th className="py-3 px-4 font-medium">판매가</th>
                <th className="py-3 px-4 font-medium">재고</th>
                <th className="py-3 px-4 font-medium">상태</th>
                <th className="py-3 px-4 font-medium">수정일</th>
                <th className="py-3 px-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="py-3 px-4">
                    <Link href={`/seller/listings/${listing.id}/edit`} className="font-semibold text-brand hover:underline">
                      {listing.manufacturer} {listing.model}
                    </Link>
                    <p className="text-xs text-muted mt-1">{listing.productCode}</p>
                  </td>
                  <td className="py-3 px-4 text-muted whitespace-nowrap">
                    {listing.width}/{listing.ratio} R {listing.rim} · {listing.dot}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-semibold">
                    {listing.price.toLocaleString()}원
                  </td>
                  <td className="py-3 px-4 tabular-nums">{listing.stock.toLocaleString()}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-semibold ${listing.status === "REJECTED" ? "text-accent" : "text-brand"}`}>
                      {statusLabels[listing.status]}
                    </span>
                    {listing.rejectedReason && (
                      <p className="text-xs text-accent mt-1 max-w-40 truncate" title={listing.rejectedReason}>
                        {listing.rejectedReason}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-muted">{formatDay(listing.updatedAt)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Link href={`/seller/listings/${listing.id}/edit`} className="btn-outline h-8 px-2.5 text-xs">
                        수정
                      </Link>
                      {listing.status === "DRAFT" && (
                        <button onClick={() => handleDelete(listing.id)} className="text-xs text-muted hover:text-accent">
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
