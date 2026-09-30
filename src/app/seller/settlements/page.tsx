"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import type { PayoutSettlementView, PayoutStatus, SellerPayoutView } from "@/lib/payout-types";
import { formatDate } from "@/lib/formatDate";

const STATUS_LABEL: Record<PayoutStatus, string> = {
  PENDING: "정산 대기",
  CONFIRMED: "정산 확정",
  PAID: "지급 완료",
};

const STATUS_TONE: Record<PayoutStatus, string> = {
  PENDING: "text-muted",
  CONFIRMED: "text-brand",
  PAID: "text-accent",
};

function won(value: number) {
  return `${value.toLocaleString()}원`;
}

export default function SellerSettlementsPage() {
  const [payout, setPayout] = useState<SellerPayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/seller/settlements", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("정산 정보를 불러오지 못했습니다.");
        return response.json() as Promise<{ payout: SellerPayoutView }>;
      })
      .then((data) => {
        if (!cancelled) setPayout(data.payout);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState />;

  if (error || !payout) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">정산 정보를 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  const { unsettled, settlements, adjustmentAmount } = payout;

  return (
    <div className="px-4 py-5 max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">정산 관리</h1>
        <p className="text-sm text-muted mt-1">
          {formatDate(payout.period.start)} ~ {formatDate(payout.period.end)} 기준 · 수수료율{" "}
          {payout.commissionRate}%
        </p>
      </div>

      <section className="mb-6">
        <h2 className="text-sm font-bold text-muted mb-2">이번 기간 미정산 예상액</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-muted">판매대금 (총액)</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums">{won(unsettled.grossAmount)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">수수료 ({payout.commissionRate}%)</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums text-accent">
              -{won(unsettled.commissionAmount)}
            </p>
          </div>
          <div className="card p-4 col-span-2 lg:col-span-1">
            <p className="text-xs text-muted">실지급 예상액</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums text-brand">{won(unsettled.netAmount)}</p>
          </div>
        </div>
        <p className="text-xs text-muted mt-2">
          미정산 주문 {unsettled.orderCount}건 기준의 예상 금액이며, 실제 정산은 본사 확정 후 진행됩니다.
          {adjustmentAmount !== 0 && <> 반품/취소 정산 조정 {won(adjustmentAmount)}이 포함된 금액입니다.</>}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-bold text-muted mb-2">정산 내역</h2>
        {settlements.length === 0 ? (
          <div className="card p-10 text-center text-muted text-sm">확정된 정산 내역이 없습니다.</div>
        ) : (
          <div className="card p-4 overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">정산 기간</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">판매대금</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">수수료</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">실지급액</th>
                  <th className="py-2 pr-3 font-medium">상태</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">확정일 / 지급일</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((settlement: PayoutSettlementView) => (
                  <tr key={settlement.id} className="border-b border-border hover:bg-surface-2">
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {formatDate(settlement.periodStart)} ~ {formatDate(settlement.periodEnd)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{won(settlement.grossAmount)}</td>
                    <td className="py-3 pr-3 tabular-nums">
                      {won(settlement.commissionAmount)}
                      <span className="text-xs text-muted ml-1">({settlement.commissionRate}%)</span>
                    </td>
                    <td className="py-3 pr-3 tabular-nums font-semibold">
                      {won(settlement.netAmount)}
                      {settlement.adjustmentAmount !== 0 && (
                        <p className="text-xs text-muted mt-1 font-normal whitespace-nowrap">
                          정산 조정 {won(settlement.adjustmentAmount)}
                        </p>
                      )}
                    </td>
                    <td className={`py-3 pr-3 text-xs font-semibold ${STATUS_TONE[settlement.status]}`}>
                      {STATUS_LABEL[settlement.status]}
                    </td>
                    <td className="py-3 pr-3 text-xs text-muted whitespace-nowrap">
                      {settlement.confirmedAt ? formatDate(settlement.confirmedAt) : "-"} /{" "}
                      {settlement.paidAt ? formatDate(settlement.paidAt) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
