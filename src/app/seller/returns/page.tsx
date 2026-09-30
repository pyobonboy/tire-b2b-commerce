"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import { formatDate } from "@/lib/formatDate";
import type { SellerReturnRequestView } from "@/lib/return-types";

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "접수됨",
  APPROVED: "승인됨 · 처리중",
  REJECTED: "반려됨",
  COMPLETED: "완료",
};

export default function SellerReturnsPage() {
  const { confirm: confirmDialog } = useDialogs();
  const [requests, setRequests] = useState<SellerReturnRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function loadRequests() {
    const response = await fetch("/api/seller/returns", { cache: "no-store" });
    if (!response.ok) throw new Error("교환/반품 신청 목록을 불러오지 못했습니다.");
    const data = (await response.json()) as { returnRequests: SellerReturnRequestView[] };
    setRequests(data.returnRequests);
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial API hydration is intentionally applied after mount
    loadRequests()
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function approve(request: SellerReturnRequestView) {
    setBusyId(request.id);
    setError(null);
    const response = await fetch(`/api/seller/returns/${request.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    if (!response.ok) {
      setError("승인 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    await loadRequests();
    setBusyId(null);
  }

  async function reject(request: SellerReturnRequestView) {
    if (!rejectReason.trim()) return;
    setBusyId(request.id);
    setError(null);
    const response = await fetch(`/api/seller/returns/${request.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approve: false, reason: rejectReason }),
    });
    if (!response.ok) {
      setError("반려 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    await loadRequests();
    setBusyId(null);
  }

  async function complete(request: SellerReturnRequestView) {
    const confirmed = await confirmDialog({
      title:
        request.type === "EXCHANGE" ? "교환 상품 발송을 완료하셨나요?" : "반품 상품을 회수하셨나요?",
      description:
        request.type === "EXCHANGE"
          ? "완료 처리하면 되돌릴 수 없습니다."
          : "완료 처리하면 재고가 복원되고 되돌릴 수 없습니다.",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(request.id);
    setError(null);
    const response = await fetch(`/api/seller/returns/${request.id}/complete`, { method: "POST" });
    if (!response.ok) {
      setError("완료 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    await loadRequests();
    setBusyId(null);
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">교환/반품 관리</h1>
        <p className="text-sm text-muted mt-1">내 상품에 접수된 교환/반품 신청을 확인하고 처리하세요.</p>
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}

      {requests.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">접수된 교환/반품 신청이 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((request) => (
            <article key={request.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4 mb-4">
                <div>
                  <p className="text-xs text-muted">
                    주문번호 {request.order.orderNo ?? request.orderId} · {formatDate(request.requestedAt)}
                  </p>
                  <h2 className="font-bold mt-1">
                    {request.type === "EXCHANGE" ? "교환" : "반품"} · {request.order.manufacturer}{" "}
                    {request.order.model}
                  </h2>
                  <p className="text-sm text-muted mt-1">
                    {request.order.width}/{request.order.ratio} R {request.order.rim} · DOT {request.order.dot} ·{" "}
                    {request.order.quantity}개 · {request.order.total.toLocaleString()}원
                  </p>
                </div>
                <span className="text-sm font-semibold text-brand">{STATUS_LABEL[request.status] ?? request.status}</span>
              </div>

              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted mb-1">구매자</p>
                  <p className="font-medium">
                    {request.buyer.businessName} / {request.buyer.ownerName}
                  </p>
                  <p className="text-muted mt-1">{request.buyer.mobilePhone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">신청 사유</p>
                  <p className="font-medium">{request.reason}</p>
                  {request.detail && <p className="text-muted mt-1 whitespace-pre-wrap">{request.detail}</p>}
                </div>
              </div>

              {request.status === "REJECTED" && request.rejectReason && (
                <p className="text-sm text-accent mt-3">반려 사유: {request.rejectReason}</p>
              )}

              {request.status === "REQUESTED" && (
                <div className="mt-4 pt-4 border-t border-border">
                  {rejectingId === request.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        rows={3}
                        placeholder="반려 사유를 입력해 주세요."
                        className="px-3 py-2.5 rounded-lg border border-border text-sm resize-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason("");
                          }}
                          className="btn-outline h-9 px-3 text-xs"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => void reject(request)}
                          disabled={busyId === request.id || !rejectReason.trim()}
                          className="h-9 px-3 text-xs rounded-lg bg-accent text-white disabled:opacity-60"
                        >
                          {busyId === request.id ? "처리 중..." : "반려하기"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setRejectingId(request.id)}
                        disabled={busyId === request.id}
                        className="btn-outline h-9 px-3 text-xs"
                      >
                        반려
                      </button>
                      <button
                        onClick={() => void approve(request)}
                        disabled={busyId === request.id}
                        className="btn-primary h-9 px-3 text-xs"
                      >
                        {busyId === request.id ? "처리 중..." : "승인"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {request.status === "APPROVED" && (
                <div className="mt-4 pt-4 border-t border-border flex justify-end">
                  <button
                    onClick={() => void complete(request)}
                    disabled={busyId === request.id}
                    className="btn-primary h-9 px-3 text-xs"
                  >
                    {busyId === request.id
                      ? "처리 중..."
                      : request.type === "EXCHANGE"
                        ? "교환 완료 처리"
                        : "반품 완료 처리"}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
