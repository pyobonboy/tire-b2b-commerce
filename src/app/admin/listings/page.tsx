"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminListingStatus, AdminListingView } from "@/lib/admin-types";

const labels: Record<AdminListingStatus, string> = { DRAFT: "작성중", PENDING: "심사 대기", ACTIVE: "판매중", REJECTED: "반려", SOLDOUT: "품절", HIDDEN: "비노출" };

function ListingsContent() {
  const searchParams = useSearchParams();
  const { prompt: promptDialog } = useDialogs();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [listings, setListings] = useState<AdminListingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    fetch(`/api/admin/listings${query}`, { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("상품 심사 목록을 불러오지 못했습니다."); return response.json() as Promise<{ listings: AdminListingView[] }>; })
      .then((data) => { if (!cancelled) { setListings(data.listings); setError(null); } })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [status]);

  async function review(id: string, approve: boolean) {
    const reason = approve ? undefined : await promptDialog({ title: "반려 사유를 입력해 주세요.", multiline: true });
    if (!approve && !reason?.trim()) return;
    const response = await fetch(`/api/admin/listings/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, ...(reason ? { reason } : {}) }) });
    if (!response.ok) { setError(approve ? "상품 승인에 실패했습니다." : "상품 반려에 실패했습니다."); return; }
    setListings((current) => current.map((listing) => listing.id === id ? { ...listing, status: approve ? (listing.stock > 0 ? "ACTIVE" : "SOLDOUT") : "REJECTED", rejectedReason: approve ? null : reason ?? null } : listing));
  }

  if (loading) return <LoadingState />;
  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5"><h1 className="text-xl font-extrabold">상품 심사</h1><p className="text-sm text-muted mt-1">판매자가 제출한 상품을 검토하고 게시 상태를 결정합니다.</p></div>
      <div className="flex items-center justify-between gap-3 mb-4"><p className="text-sm text-muted">총 <b className="text-foreground">{listings.length}</b>건</p><Select value={status} onValueChange={setStatus} items={[{ value: "", label: "전체 상태" }, { value: "PENDING", label: "심사 대기" }, { value: "ACTIVE", label: "판매중" }, { value: "REJECTED", label: "반려" }, { value: "SOLDOUT", label: "품절" }, { value: "DRAFT", label: "작성중" }, { value: "HIDDEN", label: "비노출" }]} className="h-10 px-3 rounded-lg border border-border text-sm bg-background" ariaLabel="상품 상태 필터" /></div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {listings.length === 0 ? <div className="card py-16 text-center text-sm text-muted">조건에 맞는 상품이 없습니다.</div> : <div className="card overflow-x-auto"><table className="min-w-[1050px] w-full text-sm border-collapse"><thead><tr className="text-left text-muted border-b border-border"><th className="py-3 px-4 font-medium">상품</th><th className="py-3 px-4 font-medium">판매자</th><th className="py-3 px-4 font-medium">규격 / DOT</th><th className="py-3 px-4 font-medium">가격 / 재고</th><th className="py-3 px-4 font-medium">상태</th><th className="py-3 px-4 font-medium" /></tr></thead><tbody>{listings.map((listing) => <tr key={listing.id} className="border-b border-border last:border-0 hover:bg-surface-2"><td className="py-3 px-4"><Link href={`/admin/listings/${listing.id}`} className="font-semibold text-brand hover:underline">{listing.manufacturer} {listing.model}</Link><p className="text-xs text-muted mt-1">{listing.productCode}</p></td><td className="py-3 px-4"><p>{listing.seller.businessName}</p><p className="text-xs text-muted mt-1">{listing.seller.code}</p></td><td className="py-3 px-4 text-muted whitespace-nowrap">{listing.width}/{listing.ratio} R {listing.rim} · {listing.dot}</td><td className="py-3 px-4 tabular-nums"><p>{listing.price.toLocaleString()}원</p><p className="text-xs text-muted mt-1">재고 {listing.stock.toLocaleString()}</p></td><td className={`py-3 px-4 text-xs font-semibold ${listing.status === "PENDING" ? "text-accent" : listing.status === "REJECTED" ? "text-accent" : "text-brand"}`}>{labels[listing.status]}{listing.rejectedReason && <p className="font-normal mt-1 max-w-36 truncate" title={listing.rejectedReason}>{listing.rejectedReason}</p>}</td><td className="py-3 px-4"><div className="flex items-center gap-2">{listing.status === "PENDING" && <><button onClick={() => void review(listing.id, true)} className="btn-primary h-8 px-2.5 text-xs">승인</button><button onClick={() => void review(listing.id, false)} className="btn-outline h-8 px-2.5 text-xs text-accent border-accent">반려</button></>}<Link href={`/admin/listings/${listing.id}`} className="text-xs text-muted hover:text-brand">상세</Link></div></td></tr>)}</tbody></table></div>}
    </div>
  );
}

export default function AdminListingsPage() { return <Suspense fallback={<LoadingState />}><ListingsContent /></Suspense>; }
