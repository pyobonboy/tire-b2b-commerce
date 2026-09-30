"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminBuyerStatus, AdminBuyerView } from "@/lib/admin-types";

const statusLabels: Record<AdminBuyerStatus, string> = {
  PENDING: "승인 대기",
  ACTIVE: "활성",
  SUSPENDED: "정지",
  REJECTED: "거절",
};

function BuyersContent() {
  const searchParams = useSearchParams();
  const { prompt: promptDialog } = useDialogs();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [buyers, setBuyers] = useState<AdminBuyerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    fetch(`/api/admin/buyers${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("구매자 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ buyers: AdminBuyerView[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setBuyers(data.buyers);
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

  async function approve(id: string) {
    setError(null);
    const response = await fetch(`/api/admin/buyers/${id}/approve`, { method: "POST" });
    if (!response.ok) {
      setError("구매자 승인에 실패했습니다.");
      return;
    }
    setBuyers((current) =>
      current.map((buyer) =>
        buyer.id === id
          ? {
              ...buyer,
              status: "ACTIVE",
              approvedAt: new Date().toISOString(),
              rejectedReason: null,
              suspendReason: null,
            }
          : buyer,
      ),
    );
  }

  async function reject(id: string) {
    const reason = await promptDialog({ title: "거절 사유를 입력해 주세요.", multiline: true });
    if (!reason?.trim()) return;
    setError(null);
    const response = await fetch(`/api/admin/buyers/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      setError("구매자 거절에 실패했습니다.");
      return;
    }
    setBuyers((current) =>
      current.map((buyer) =>
        buyer.id === id ? { ...buyer, status: "REJECTED", rejectedReason: reason } : buyer,
      ),
    );
  }

  async function suspend(id: string) {
    const reason = await promptDialog({ title: "정지 사유를 입력해 주세요.", multiline: true });
    if (!reason?.trim()) return;
    setError(null);
    const response = await fetch(`/api/admin/buyers/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      setError("구매자 정지에 실패했습니다.");
      return;
    }
    setBuyers((current) =>
      current.map((buyer) =>
        buyer.id === id ? { ...buyer, status: "SUSPENDED", suspendReason: reason } : buyer,
      ),
    );
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">구매자 관리</h1>
        <p className="text-sm text-muted mt-1">
          사업자등록번호를 가진 타이어 가게·정비소의 가입 신청과 이용 상태를 관리합니다.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{buyers.length}</b>명
        </p>
        <Select
          value={status}
          onValueChange={(value) => {
            setLoading(true);
            setStatus(value);
          }}
          items={[
            { value: "", label: "전체 상태" },
            { value: "PENDING", label: "승인 대기" },
            { value: "ACTIVE", label: "활성" },
            { value: "SUSPENDED", label: "정지" },
            { value: "REJECTED", label: "거절" },
          ]}
          className="h-10 px-3 rounded-lg border border-border text-sm bg-background"
          ariaLabel="구매자 상태 필터"
        />
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {buyers.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">조건에 맞는 구매자가 없습니다.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-3 px-4 font-medium">사업자</th>
                <th className="py-3 px-4 font-medium">대표자 / 연락처</th>
                <th className="py-3 px-4 font-medium">상태</th>
                <th className="py-3 px-4 font-medium">신청일</th>
                <th className="py-3 px-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {buyers.map((buyer) => (
                <tr key={buyer.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="py-3 px-4">
                    <p className="font-semibold">{buyer.user.businessName}</p>
                    <p className="text-xs text-muted mt-1">
                      {buyer.user.loginId} · {buyer.user.businessRegNumber}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <p>{buyer.user.ownerName}</p>
                    <p className="text-xs text-muted mt-1">{buyer.user.mobilePhone}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-xs font-semibold ${
                        buyer.status === "SUSPENDED" || buyer.status === "REJECTED"
                          ? "text-accent"
                          : buyer.status === "PENDING"
                            ? "text-yellow-600"
                            : "text-brand"
                      }`}
                    >
                      {statusLabels[buyer.status]}
                    </span>
                    {buyer.rejectedReason && (
                      <p className="text-xs text-accent mt-1 max-w-52 truncate" title={buyer.rejectedReason}>
                        {buyer.rejectedReason}
                      </p>
                    )}
                    {buyer.suspendReason && (
                      <p className="text-xs text-accent mt-1 max-w-52 truncate" title={buyer.suspendReason}>
                        {buyer.suspendReason}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-muted">
                    {new Date(buyer.user.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      {buyer.status === "PENDING" && (
                        <>
                          <button onClick={() => void approve(buyer.id)} className="btn-primary h-8 px-2.5 text-xs">
                            승인
                          </button>
                          <button onClick={() => void reject(buyer.id)} className="btn-outline h-8 px-2.5 text-xs text-accent border-accent">
                            거절
                          </button>
                        </>
                      )}
                      {buyer.status !== "SUSPENDED" && buyer.status !== "REJECTED" && (
                        <button onClick={() => void suspend(buyer.id)} className="btn-outline h-8 px-2.5 text-xs text-accent border-accent">
                          정지
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

export default function AdminBuyersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BuyersContent />
    </Suspense>
  );
}
