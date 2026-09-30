"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminListingView, AdminSellerView } from "@/lib/admin-types";

const statusLabels = { PENDING: "승인 대기", ACTIVE: "활성", SUSPENDED: "정지" } as const;
const listingLabels = { DRAFT: "작성중", PENDING: "심사 대기", ACTIVE: "판매중", REJECTED: "반려", SOLDOUT: "품절", HIDDEN: "비노출" } as const;

export default function AdminSellerDetailPage() {
  const params = useParams<{ id: string }>();
  const { confirm: confirmDialog, prompt: promptDialog } = useDialogs();
  const [seller, setSeller] = useState<AdminSellerView | null>(null);
  const [listings, setListings] = useState<AdminListingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/sellers", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("판매자 정보를 불러오지 못했습니다.");
        return response.json() as Promise<{ sellers: AdminSellerView[] }>;
      }),
      fetch("/api/admin/listings", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("소속 상품을 불러오지 못했습니다.");
        return response.json() as Promise<{ listings: AdminListingView[] }>;
      }),
    ])
      .then(([sellerData, listingData]) => {
        if (!cancelled) {
          setSeller(sellerData.sellers.find((item) => item.id === params.id) ?? null);
          setListings(listingData.listings.filter((item) => item.seller.id === params.id));
        }
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  async function approve() {
    if (!seller) return;
    const response = await fetch(`/api/admin/sellers/${seller.id}/approve`, { method: "POST" });
    if (!response.ok) { setError("승인 처리에 실패했습니다."); return; }
    setSeller((current) => current ? { ...current, status: "ACTIVE", suspendReason: null } : current);
  }

  async function suspend() {
    if (!seller) return;
    const reason = await promptDialog({ title: "정지 사유를 입력해 주세요.", multiline: true });
    if (!reason?.trim()) return;
    const response = await fetch(`/api/admin/sellers/${seller.id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    if (!response.ok) { setError("정지 처리에 실패했습니다."); return; }
    setSeller((current) => current ? { ...current, status: "SUSPENDED", suspendReason: reason } : current);
  }

  async function reinstate() {
    if (!seller) return;
    if (!(await confirmDialog({ title: "정지를 해제할까요?", description: "이 가맹점의 정지를 해제하고 활성 상태로 되돌립니다." }))) return;
    const response = await fetch(`/api/admin/sellers/${seller.id}/reinstate`, { method: "POST" });
    if (!response.ok) { setError("복구 처리에 실패했습니다."); return; }
    setSeller((current) => current ? { ...current, status: "ACTIVE", suspendReason: null } : current);
  }

  if (loading) return <LoadingState />;
  if (error || !seller) return <div className="px-4 py-16 text-center"><p className="text-accent mb-4">{error ?? "판매자를 찾을 수 없습니다."}</p><Link href="/admin/sellers" className="text-brand font-semibold">판매자 목록으로</Link></div>;

  return (
    <div className="px-4 py-5 max-w-7xl">
      <Link href="/admin/sellers" className="text-sm text-muted hover:text-brand">← 판매자 목록</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-3 mb-5">
        <div><h1 className="text-xl font-extrabold">{seller.user.businessName}</h1><p className="text-sm text-muted mt-1">{seller.code} · {seller.user.ownerName}</p></div>
        <div className="flex gap-2">{seller.status === "PENDING" && <button onClick={() => void approve()} className="btn-primary h-10 px-4">승인</button>}{seller.status === "SUSPENDED" ? <button onClick={() => void reinstate()} className="btn-outline h-10 px-4">복구</button> : <button onClick={() => void suspend()} className="btn-outline h-10 px-4 text-accent border-accent">정지</button>}</div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <section className="card p-5"><h2 className="font-bold mb-4">사업자 정보 <span className="text-xs text-brand ml-2">{statusLabels[seller.status]}</span></h2><div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm"><Info label="사업자등록번호" value={seller.user.businessRegNumber} /><Info label="대표자" value={seller.user.ownerName} /><Info label="휴대전화" value={seller.user.mobilePhone} /><Info label="이메일" value={seller.user.email ?? "-"} /><Info label="사무실 전화" value={seller.user.officePhone ?? "-"} /><Info label="주소" value={`${seller.user.postalCode ?? ""} ${seller.user.address ?? "-"}`} /></div>{seller.suspendReason && <p className="text-sm text-accent mt-4">정지 사유: {seller.suspendReason}</p>}</section>
        <section className="card p-5"><h2 className="font-bold mb-4">배송·소개 정보</h2><div className="flex flex-col gap-3 text-sm"><Info label="택배사" value={seller.courier} /><Info label="배송 안내" value={seller.shippingNote ?? "-"} /><Info label="위치" value={seller.location ?? "-"} /><Info label="소개" value={seller.intro ?? "-"} /></div></section>
      </div>

      <section className="card overflow-x-auto"><div className="p-5 pb-3"><h2 className="font-bold">소속 상품 ({listings.length})</h2></div>{listings.length === 0 ? <p className="text-sm text-muted text-center py-10">등록한 상품이 없습니다.</p> : <table className="min-w-[800px] w-full text-sm border-collapse"><thead><tr className="text-left text-muted border-b border-border"><th className="py-3 px-4 font-medium">상품</th><th className="py-3 px-4 font-medium">규격 / DOT</th><th className="py-3 px-4 font-medium">판매가</th><th className="py-3 px-4 font-medium">재고</th><th className="py-3 px-4 font-medium">상태</th><th className="py-3 px-4" /></tr></thead><tbody>{listings.map((listing) => <tr key={listing.id} className="border-b border-border last:border-0"><td className="py-3 px-4">{listing.model}<p className="text-xs text-muted mt-1">{listing.productCode}</p></td><td className="py-3 px-4 text-muted">{listing.width}/{listing.ratio} R {listing.rim} · {listing.dot}</td><td className="py-3 px-4 tabular-nums">{listing.price.toLocaleString()}원</td><td className="py-3 px-4 tabular-nums">{listing.stock.toLocaleString()}</td><td className="py-3 px-4 text-xs">{listingLabels[listing.status]}</td><td className="py-3 px-4"><Link href={`/admin/listings/${listing.id}`} className="text-xs text-brand hover:underline">심사 보기</Link></td></tr>)}</tbody></table>}</section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted">{label}</p><p className="font-medium mt-1 break-words">{value}</p></div>; }
