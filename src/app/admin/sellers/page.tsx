"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminSellerStatus, AdminSellerView } from "@/lib/admin-types";

const statusLabels: Record<AdminSellerStatus, string> = {
  PENDING: "승인 대기",
  ACTIVE: "활성",
  SUSPENDED: "정지",
};

function SellersContent() {
  const searchParams = useSearchParams();
  const { confirm: confirmDialog, prompt: promptDialog } = useDialogs();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [sellers, setSellers] = useState<AdminSellerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    fetch(`/api/admin/sellers${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("가맹점 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ sellers: AdminSellerView[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setSellers(data.sellers);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status]);

  async function approve(id: string) {
    setError(null);
    const response = await fetch(`/api/admin/sellers/${id}/approve`, { method: "POST" });
    if (!response.ok) {
      setError("가맹점 승인에 실패했습니다.");
      return;
    }
    setSellers((current) => current.map((seller) => seller.id === id ? { ...seller, status: "ACTIVE" } : seller));
  }

  async function suspend(id: string) {
    const reason = await promptDialog({ title: "정지 사유를 입력해 주세요.", multiline: true });
    if (!reason?.trim()) return;
    setError(null);
    const response = await fetch(`/api/admin/sellers/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      setError("가맹점 정지에 실패했습니다.");
      return;
    }
    setSellers((current) => current.map((seller) => seller.id === id ? { ...seller, status: "SUSPENDED", suspendReason: reason } : seller));
  }

  async function reinstate(id: string) {
    if (!(await confirmDialog({ title: "정지를 해제할까요?", description: "이 가맹점의 정지를 해제하고 활성 상태로 되돌립니다." }))) return;
    setError(null);
    const response = await fetch(`/api/admin/sellers/${id}/reinstate`, { method: "POST" });
    if (!response.ok) {
      setError("가맹점 복구에 실패했습니다.");
      return;
    }
    setSellers((current) => current.map((seller) => seller.id === id ? { ...seller, status: "ACTIVE", suspendReason: null } : seller));
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5"><h1 className="text-xl font-extrabold">판매자 관리</h1><p className="text-sm text-muted mt-1">가맹점 가입을 승인하거나 운영 상태를 관리합니다.</p></div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">총 <b className="text-foreground">{sellers.length}</b>개</p>
        <Select value={status} onValueChange={setStatus} items={[{ value: "", label: "전체 상태" }, { value: "PENDING", label: "승인 대기" }, { value: "ACTIVE", label: "활성" }, { value: "SUSPENDED", label: "정지" }]} className="h-10 px-3 rounded-lg border border-border text-sm bg-background" ariaLabel="가맹점 상태 필터" />
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {sellers.length === 0 ? <div className="card py-16 text-center text-sm text-muted">조건에 맞는 가맹점이 없습니다.</div> : (
        <div className="card overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm border-collapse">
            <thead><tr className="text-left text-muted border-b border-border"><th className="py-3 px-4 font-medium">가맹점</th><th className="py-3 px-4 font-medium">대표자 / 연락처</th><th className="py-3 px-4 font-medium">상품 수</th><th className="py-3 px-4 font-medium">상태</th><th className="py-3 px-4 font-medium">신청일</th><th className="py-3 px-4 font-medium" /></tr></thead>
            <tbody>
              {sellers.map((seller) => (
                <tr key={seller.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="py-3 px-4"><Link href={`/admin/sellers/${seller.id}`} className="font-semibold text-brand hover:underline">{seller.user.businessName}</Link><p className="text-xs text-muted mt-1">{seller.code} · {seller.user.businessRegNumber}</p></td>
                  <td className="py-3 px-4"><p>{seller.user.ownerName}</p><p className="text-xs text-muted mt-1">{seller.user.mobilePhone}</p></td>
                  <td className="py-3 px-4 tabular-nums">{seller.listingCount}</td>
                  <td className="py-3 px-4"><span className={`text-xs font-semibold ${seller.status === "SUSPENDED" ? "text-accent" : seller.status === "PENDING" ? "text-yellow-600" : "text-brand"}`}>{statusLabels[seller.status]}</span>{seller.suspendReason && <p className="text-xs text-accent mt-1 max-w-40 truncate" title={seller.suspendReason}>{seller.suspendReason}</p>}</td>
                  <td className="py-3 px-4 text-xs text-muted">{new Date(seller.user.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td className="py-3 px-4"><div className="flex items-center gap-2">{seller.status === "PENDING" && <button onClick={() => void approve(seller.id)} className="btn-primary h-8 px-2.5 text-xs">승인</button>}{seller.status === "SUSPENDED" ? <button onClick={() => void reinstate(seller.id)} className="btn-outline h-8 px-2.5 text-xs">복구</button> : <button onClick={() => void suspend(seller.id)} className="btn-outline h-8 px-2.5 text-xs text-accent border-accent">정지</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminSellersPage() {
  return <Suspense fallback={<LoadingState />}><SellersContent /></Suspense>;
}
