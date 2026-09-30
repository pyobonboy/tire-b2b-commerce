"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminListingView } from "@/lib/admin-types";

const labels = { DRAFT: "작성중", PENDING: "심사 대기", ACTIVE: "판매중", REJECTED: "반려", SOLDOUT: "품절", HIDDEN: "비노출" } as const;

export default function AdminListingDetailPage() {
  const params = useParams<{ id: string }>();
  const { prompt: promptDialog } = useDialogs();
  const [listing, setListing] = useState<AdminListingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/listings", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("상품 정보를 불러오지 못했습니다."); return response.json() as Promise<{ listings: AdminListingView[] }>; })
      .then((data) => { if (!cancelled) setListing(data.listings.find((item) => item.id === params.id) ?? null); })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  async function review(approve: boolean) {
    if (!listing) return;
    let reason: string | null | undefined = undefined;
    if (!approve) {
      reason = await promptDialog({ title: "반려 사유를 입력해 주세요.", multiline: true });
      if (!reason?.trim()) return;
    }
    const response = await fetch(`/api/admin/listings/${listing.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, ...(reason ? { reason } : {}) }) });
    if (!response.ok) { setError(approve ? "상품 승인에 실패했습니다." : "상품 반려에 실패했습니다."); return; }
    setListing((current) => current ? { ...current, status: approve ? (current.stock > 0 ? "ACTIVE" : "SOLDOUT") : "REJECTED", rejectedReason: approve ? null : reason ?? null } : current);
  }

  async function delist() {
    if (!listing) return;
    const reason = await promptDialog({ title: "판매 중지 사유를 입력해 주세요.", multiline: true });
    if (!reason?.trim()) return;
    const response = await fetch(`/api/admin/listings/${listing.id}/delist`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setError(data?.error === "LISTING_NOT_LIVE" ? "이미 판매 중이 아닌 상품입니다." : "상품 판매 중지에 실패했습니다.");
      return;
    }
    setListing((current) => current ? { ...current, status: "REJECTED", rejectedReason: reason } : current);
  }

  if (loading) return <LoadingState />;
  if (error || !listing) return <div className="px-4 py-16 text-center"><p className="text-accent mb-4">{error ?? "상품을 찾을 수 없습니다."}</p><Link href="/admin/listings" className="text-brand font-semibold">상품 심사 목록으로</Link></div>;

  return (
    <div className="px-4 py-5 max-w-6xl">
      <Link href="/admin/listings" className="text-sm text-muted hover:text-brand">← 상품 심사 목록</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-3 mb-5"><div><h1 className="text-xl font-extrabold">상품 심사 상세</h1><p className="text-sm text-muted mt-1">{listing.manufacturer} {listing.model} · {listing.seller.businessName}</p></div><span className={`text-sm font-semibold ${listing.status === "PENDING" || listing.status === "REJECTED" ? "text-accent" : "text-brand"}`}>{labels[listing.status]}</span></div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {listing.rejectedReason && <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-accent mb-4">반려 사유: {listing.rejectedReason}</div>}
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-5"><h2 className="font-bold mb-4">상품 정보</h2><div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm"><Info label="제조사" value={listing.manufacturer} /><Info label="모델" value={listing.model} /><Info label="규격" value={`${listing.width} / ${listing.ratio} R ${listing.rim}`} /><Info label="DOT" value={listing.dot} /><Info label="하중/속도" value={`${listing.loadIndex} / ${listing.speedIndex}`} /><Info label="타이어 겹수" value={listing.ply} /><Info label="OE" value={listing.oe ?? "-"} /><Info label="계절" value={listing.season} /><Info label="상품번호" value={listing.productCode} /><Info label="태그" value={listing.tag ?? "-"} /></div></section>
        <section className="card p-5"><h2 className="font-bold mb-4">판매 조건</h2><div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm"><Info label="공장도가" value={`${listing.factoryPrice.toLocaleString()}원`} /><Info label="판매가" value={`${listing.price.toLocaleString()}원`} /><Info label="할인율" value={`${listing.discountRate}%`} /><Info label="재고" value={listing.stock.toLocaleString()} /><Info label="최소 주문" value={listing.minOrder.toLocaleString()} /><Info label="택배 판매자" value={`${listing.seller.code} · ${listing.seller.businessName}`} /></div></section>
      </div>
      {listing.status === "PENDING" && <div className="flex justify-end gap-2 mt-5"><button onClick={() => void review(false)} className="btn-outline h-11 px-5 text-accent border-accent">반려</button><button onClick={() => void review(true)} className="btn-primary h-11 px-5">승인 및 게시</button></div>}
      {(listing.status === "ACTIVE" || listing.status === "SOLDOUT") && <div className="flex justify-end gap-2 mt-5"><button onClick={() => void delist()} className="btn-outline text-accent border-accent h-11 px-5">판매 중지</button></div>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted">{label}</p><p className="font-medium mt-1 break-words">{value}</p></div>; }
