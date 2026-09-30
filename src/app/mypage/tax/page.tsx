"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import type { SettlementView } from "@/lib/settlement-types";
import type { TaxInvoiceView } from "@/lib/tax-invoice-types";

// Same UTC-month convention requestTaxInvoice (src/lib/server/taxInvoice.ts)
// gates on — see that file's currentMonthString for why this must not be a
// KST-shifted computation.
function currentMonthString() {
  return new Date().toISOString().slice(0, 7);
}

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "신청됨",
  ISSUED: "발행완료",
  REJECTED: "반려됨",
  CANCELED: "취소됨",
};

const STATUS_STYLE: Record<string, string> = {
  REQUESTED: "bg-accent/10 text-accent",
  ISSUED: "bg-success/10 text-success",
  REJECTED: "bg-muted/10 text-muted",
  CANCELED: "bg-muted/10 text-muted",
};

function TaxInvoiceCell({
  month,
  invoice,
  requesting,
  onRequest,
}: {
  month: string;
  invoice: TaxInvoiceView | undefined;
  requesting: boolean;
  onRequest: () => void;
}) {
  if (invoice) {
    return (
      <div className="flex flex-col gap-1 items-start">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[invoice.status] ?? "bg-muted/10 text-muted"}`}>
          {STATUS_LABEL[invoice.status] ?? invoice.status}
        </span>
        {invoice.status === "ISSUED" && invoice.externalId && (
          <span className="text-[11px] text-muted">승인번호 {invoice.externalId}</span>
        )}
        {(invoice.status === "REJECTED" || invoice.status === "CANCELED") && (
          <button
            type="button"
            onClick={onRequest}
            disabled={requesting}
            className="text-[11px] text-brand underline underline-offset-2 disabled:opacity-50"
          >
            {requesting ? "신청 중..." : "다시 신청"}
          </button>
        )}
      </div>
    );
  }
  if (month >= currentMonthString()) {
    // 진행 중인 달은 금액이 아직 확정되지 않아 신청할 수 없다 — requestTaxInvoice
    // (taxInvoice.ts)도 서버에서 동일하게 거절한다.
    return <span className="text-[11px] text-muted">진행중</span>;
  }
  return (
    <button
      type="button"
      onClick={onRequest}
      disabled={requesting}
      className="text-xs text-brand underline underline-offset-2 disabled:opacity-50"
    >
      {requesting ? "신청 중..." : "세금계산서 신청"}
    </button>
  );
}

function TaxContent() {
  const [settlement, setSettlement] = useState<SettlementView | null>(null);
  const [invoicesByMonth, setInvoicesByMonth] = useState<Record<string, TaxInvoiceView>>({});
  const [year, setYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [requestingMonth, setRequestingMonth] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  function loadTaxInvoices() {
    return fetch("/api/tax-invoices", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("세금계산서 신청 내역을 불러오지 못했습니다.");
        return response.json() as Promise<{ taxInvoices: TaxInvoiceView[] }>;
      })
      .then((data) => {
        setInvoicesByMonth(Object.fromEntries(data.taxInvoices.map((invoice) => [invoice.periodMonth, invoice])));
      });
  }

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/account/settlement", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("세금계산서 집계를 불러오지 못했습니다.");
        return response.json() as Promise<{ settlement: SettlementView }>;
      }),
      loadTaxInvoices(),
    ])
      .then(([data]) => {
        if (cancelled) return;
        setSettlement(data.settlement);
        // Guard against an empty dataset instead of assuming taxYears[0]
        // exists — a buyer with no paid orders yet has an empty taxYears
        // array, and reading [0] on that would previously have crashed the
        // page (see the old YEARS[0] default state).
        setYear(data.settlement.taxYears[0] ?? null);
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
  }, []);

  async function requestInvoice(month: string) {
    setRequestingMonth(month);
    setRequestError(null);
    try {
      const response = await fetch("/api/tax-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodMonth: month }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setRequestError(
          body?.error === "NO_PAID_ORDERS"
            ? "해당 월에 결제된 주문이 없어 신청할 수 없습니다."
            : body?.error === "PERIOD_NOT_ELAPSED"
              ? "아직 진행 중인 달은 신청할 수 없습니다."
              : body?.error === "ALREADY_REQUESTED_OR_ISSUED"
                ? "이미 신청되었거나 발행된 세금계산서가 있습니다."
                : "세금계산서 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      await loadTaxInvoices();
    } finally {
      setRequestingMonth(null);
    }
  }

  if (loading) return <LoadingState />;

  if (loadError || !settlement) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">세금계산서 집계를 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (settlement.scope === "NOT_APPLICABLE") {
    return (
      <div className="px-4 py-5">
        <h1 className="text-xl font-extrabold mb-5">세금계산서 내역</h1>
        <div className="card p-10 text-center text-muted text-sm">{settlement.scopeMessage}</div>
      </div>
    );
  }

  const { taxYears, taxByYear } = settlement;
  const records = year ? (taxByYear[year] ?? []) : [];
  const totalSupply = records.reduce((s, r) => s + r.supplyAmount, 0);
  const totalVat = records.reduce((s, r) => s + r.vat, 0);
  const totalSum = records.reduce((s, r) => s + r.total, 0);

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-1">세금계산서 내역</h1>
      {/* This app never issues a 세금계산서 automatically and has no 국세청
          연동 — the table below is a 월별 결제금액 집계 (참고용) computed from
          the buyer's own paid orders, not itself an issued tax invoice. That
          must stay unmistakable here so an operator or 세무 담당자 never
          treats this aggregate as an official invoice record. Per-row status
          (신청됨/발행완료/반려됨) is the actual source of truth for whether a
          real invoice exists for that month — see the "세금계산서" column. */}
      <p className="text-xs text-accent font-semibold mb-5">
        ※ 아래 집계는 결제 금액을 기준으로 한 월별 참고용 수치이며, 그 자체로는 실제 발행된
        세금계산서가 아닙니다. 세금계산서가 필요한 달은 아래에서 신청하고 발행 여부를 확인하세요.
      </p>
      {requestError && <p className="text-sm text-accent font-medium mb-4">{requestError}</p>}

      {taxYears.length === 0 ? (
        <div className="card p-10 text-center text-muted text-sm">집계할 결제 내역이 없습니다.</div>
      ) : (
        <>
          <div className="flex gap-2 mb-5 overflow-x-auto">
            {taxYears.map((y) => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold shrink-0 active:scale-95 transition-all ${
                  year === y
                    ? "bg-gradient-to-r from-brand-light to-brand text-white shadow-[0_4px_14px_-4px_rgba(99,102,241,0.55)]"
                    : "bg-surface border border-border text-muted hover:text-brand hover:border-brand/50"
                }`}
              >
                {y}년
              </button>
            ))}
          </div>

          <div className="card p-4 overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">년-월</th>
                  <th className="py-2 pr-3 font-medium">공급가액</th>
                  <th className="py-2 pr-3 font-medium">부가세액</th>
                  <th className="py-2 pr-3 font-medium">합계금액</th>
                  <th className="py-2 pr-3 font-medium">세금계산서</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.month} className="border-b border-border hover:bg-surface-2">
                    <td className="py-3 pr-3">{r.month}</td>
                    <td className="py-3 pr-3">{r.supplyAmount.toLocaleString()}원</td>
                    <td className="py-3 pr-3">{r.vat.toLocaleString()}원</td>
                    <td className="py-3 pr-3 font-semibold">{r.total.toLocaleString()}원</td>
                    <td className="py-3 pr-3">
                      <TaxInvoiceCell
                        month={r.month}
                        invoice={invoicesByMonth[r.month]}
                        requesting={requestingMonth === r.month}
                        onRequest={() => void requestInvoice(r.month)}
                      />
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="py-3 pr-3">총 합계</td>
                  <td className="py-3 pr-3">{totalSupply.toLocaleString()}원</td>
                  <td className="py-3 pr-3">{totalVat.toLocaleString()}원</td>
                  <td className="py-3 pr-3">{totalSum.toLocaleString()}원</td>
                  <td className="py-3 pr-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function TaxPage() {
  return (
    <RequireAuth>
      <TaxContent />
    </RequireAuth>
  );
}
