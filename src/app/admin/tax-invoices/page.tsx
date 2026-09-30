"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { formatDate } from "@/lib/formatDate";
import type { AdminTaxInvoiceView } from "@/lib/tax-invoice-types";

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "신청됨",
  ISSUED: "발행완료",
  REJECTED: "반려됨",
  CANCELED: "취소됨",
};

function AdminTaxInvoicesContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [invoices, setInvoices] = useState<AdminTaxInvoiceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [externalId, setExternalId] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function loadInvoices() {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return fetch(`/api/admin/tax-invoices${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("세금계산서 신청 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ taxInvoices: AdminTaxInvoiceView[] }>;
      })
      .then((data) => setInvoices(data.taxInvoices));
  }

  useEffect(() => {
    let cancelled = false;
    loadInvoices()
      .then(() => {
        if (!cancelled) setError(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadInvoices closes over `status`, which is already the dependency below
  }, [status]);

  async function issue(invoice: AdminTaxInvoiceView) {
    if (!externalId.trim()) return;
    setBusyId(invoice.id);
    setError(null);
    const response = await fetch(`/api/admin/tax-invoices/${invoice.id}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ externalId }),
    });
    if (!response.ok) {
      setError("발행 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    setIssuingId(null);
    setExternalId("");
    await loadInvoices();
    setBusyId(null);
  }

  async function reject(invoice: AdminTaxInvoiceView) {
    if (!rejectReason.trim()) return;
    setBusyId(invoice.id);
    setError(null);
    const response = await fetch(`/api/admin/tax-invoices/${invoice.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    });
    if (!response.ok) {
      setError("반려 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    setRejectingId(null);
    setRejectReason("");
    await loadInvoices();
    setBusyId(null);
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">세금계산서 관리</h1>
        <p className="text-sm text-muted mt-1">
          구매자의 세금계산서 신청을 확인하고, 외부 발행 시스템에서 발행한 뒤 승인번호를 기록합니다.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{invoices.length}</b>건
        </p>
        <Select
          value={status}
          onValueChange={setStatus}
          items={[
            { value: "", label: "전체 상태" },
            { value: "REQUESTED", label: "신청됨" },
            { value: "ISSUED", label: "발행완료" },
            { value: "REJECTED", label: "반려됨" },
          ]}
          className="h-10 px-3 rounded-lg border border-border text-sm bg-background"
          ariaLabel="상태 필터"
        />
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}

      {invoices.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">조건에 맞는 신청이 없습니다.</div>
      ) : (
        <div className="card divide-y divide-border">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{invoice.periodMonth} 세금계산서</p>
                  <p className="text-xs text-muted mt-1">
                    {invoice.user.businessName} ({invoice.user.loginId}) · 신청 {formatDate(invoice.requestedAt)}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    invoice.status === "ISSUED"
                      ? "text-success"
                      : invoice.status === "REJECTED"
                        ? "text-muted"
                        : "text-accent"
                  }`}
                >
                  {STATUS_LABEL[invoice.status] ?? invoice.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                <p className="text-muted">
                  공급가액 <span className="text-foreground">{invoice.supplyAmount.toLocaleString()}원</span>
                </p>
                <p className="text-muted">
                  부가세 <span className="text-foreground">{invoice.vat.toLocaleString()}원</span>
                </p>
                <p className="text-muted">
                  합계 <span className="text-foreground font-semibold">{invoice.totalAmount.toLocaleString()}원</span>
                </p>
              </div>

              {invoice.status === "ISSUED" && invoice.externalId && (
                <p className="text-xs text-muted mt-2">승인번호 {invoice.externalId}</p>
              )}
              {invoice.status === "REJECTED" && invoice.rejectReason && (
                <p className="text-sm text-accent mt-2">반려 사유: {invoice.rejectReason}</p>
              )}

              {invoice.status === "REQUESTED" && (
                <div className="mt-3 flex flex-col gap-2">
                  {issuingId === invoice.id && (
                    <div className="flex gap-2">
                      <input
                        value={externalId}
                        onChange={(event) => setExternalId(event.target.value)}
                        placeholder="외부 발행 시스템 승인번호"
                        className="flex-1 h-9 px-3 rounded-lg border border-border text-sm"
                      />
                      <button
                        onClick={() => void issue(invoice)}
                        disabled={busyId === invoice.id || !externalId.trim()}
                        className="btn-primary h-9 px-3 text-xs disabled:opacity-60"
                      >
                        {busyId === invoice.id ? "처리 중..." : "발행 확정"}
                      </button>
                    </div>
                  )}
                  {rejectingId === invoice.id && (
                    <div className="flex gap-2">
                      <input
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        placeholder="반려 사유"
                        className="flex-1 h-9 px-3 rounded-lg border border-border text-sm"
                      />
                      <button
                        onClick={() => void reject(invoice)}
                        disabled={busyId === invoice.id || !rejectReason.trim()}
                        className="h-9 px-3 text-xs rounded-lg bg-accent text-white disabled:opacity-60"
                      >
                        {busyId === invoice.id ? "처리 중..." : "반려 확정"}
                      </button>
                    </div>
                  )}
                  {issuingId !== invoice.id && rejectingId !== invoice.id && (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setRejectingId(invoice.id)}
                        className="btn-outline h-8 px-2.5 text-xs"
                      >
                        반려
                      </button>
                      <button
                        onClick={() => setIssuingId(invoice.id)}
                        className="btn-primary h-8 px-2.5 text-xs"
                      >
                        발행
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminTaxInvoicesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminTaxInvoicesContent />
    </Suspense>
  );
}
