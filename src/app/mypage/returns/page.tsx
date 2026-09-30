"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import { formatDate } from "@/lib/formatDate";
import type { BuyerReturnRequestView } from "@/lib/return-types";

const STATUS_STYLE: Record<string, string> = {
  REQUESTED: "bg-accent/10 text-accent",
  APPROVED: "bg-brand/10 text-brand",
  REJECTED: "bg-muted/10 text-muted",
  COMPLETED: "bg-success/10 text-success",
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "접수됨",
  APPROVED: "승인됨",
  REJECTED: "반려됨",
  COMPLETED: "완료",
};

function ReturnsContent() {
  const [requests, setRequests] = useState<BuyerReturnRequestView[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/returns", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("교환/반품 내역을 불러오지 못했습니다.");
        return response.json() as Promise<{ returnRequests: BuyerReturnRequestView[] }>;
      })
      .then((data) => {
        if (!cancelled) setRequests(data.returnRequests);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-extrabold">교환 / 반품 신청내역</h1>
        <Link href="/mypage/returns/new" className="btn-primary h-9 px-3 text-xs">
          새 교환/반품 신청
        </Link>
      </div>
      <p className="text-sm text-muted mb-5">
        {requests === null ? "불러오는 중..." : `총 ${requests.length}건`}
      </p>

      {loadError ? (
        <div className="card p-10 text-center text-muted text-sm">
          교환/반품 내역을 불러오지 못했습니다.
          <br />
          <button className="btn-outline mt-4" onClick={() => window.location.reload()}>
            다시 시도
          </button>
        </div>
      ) : requests === null ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <div className="card p-10 text-center text-muted text-sm">
          신청한 교환/반품이 없습니다.
          <br />
          배송완료된 주문의 상세에서 신청할 수 있습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <div key={request.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    {request.type === "EXCHANGE" ? "교환" : "반품"} · {request.order.manufacturer}{" "}
                    {request.order.model}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {request.order.width}/{request.order.ratio} R {request.order.rim} · {request.sellerCode} · 주문
                    {formatDate(request.order.orderedAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    STATUS_STYLE[request.status] ?? "bg-muted/10 text-muted"
                  }`}
                >
                  {STATUS_LABEL[request.status] ?? request.status}
                </span>
              </div>
              <p className="text-sm mt-2">사유: {request.reason}</p>
              {request.status === "REJECTED" && request.rejectReason && (
                <p className="text-sm text-accent mt-1">반려 사유: {request.rejectReason}</p>
              )}
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs text-muted">
                <span>신청일 {formatDate(request.requestedAt)}</span>
                <Link
                  href={`/mypage/returns/new?orderId=${encodeURIComponent(request.orderId)}`}
                  className="text-brand underline underline-offset-2"
                >
                  상세 보기
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyReturnsPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <ReturnsContent />
    </RequireAuth>
  );
}
