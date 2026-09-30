"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import type { SettlementView } from "@/lib/settlement-types";
import { formatDate } from "@/lib/formatDate";

function ExtraFeesContent() {
  const [settlement, setSettlement] = useState<SettlementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/account/settlement", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("추가비용 내역을 불러오지 못했습니다.");
        return response.json() as Promise<{ settlement: SettlementView }>;
      })
      .then((data) => {
        if (!cancelled) setSettlement(data.settlement);
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

  if (loading) return <LoadingState />;

  if (loadError || !settlement) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">추가비용 내역을 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (settlement.scope === "NOT_APPLICABLE") {
    return (
      <div className="px-4 py-5">
        <h1 className="text-xl font-extrabold mb-5">추가비용 내역</h1>
        <div className="card p-10 text-center text-muted text-sm">{settlement.scopeMessage}</div>
      </div>
    );
  }

  const { extraFees, extraFeesTotal } = settlement;

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-1">추가비용 내역</h1>
      <p className="text-sm text-muted mb-1">총 {extraFees.length}건</p>
      <p className="text-sm font-semibold mb-5">
        추가비용 합계 : <span className="text-brand">{extraFeesTotal.toLocaleString()}원</span>
      </p>

      {extraFees.length === 0 ? (
        <div className="card p-10 text-center text-muted text-sm">조회된 추가비용 내역이 없습니다.</div>
      ) : (
        <div className="card p-4 overflow-x-auto">
          <table className="min-w-[480px] w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-2 pr-3 font-medium">주문번호</th>
                <th className="py-2 pr-3 font-medium">주문상품</th>
                <th className="py-2 pr-3 font-medium whitespace-nowrap">추가배송비</th>
                <th className="py-2 pr-3 font-medium">주문일자</th>
              </tr>
            </thead>
            <tbody>
              {extraFees.map((e) => (
                <tr key={e.orderId} className="border-b border-border hover:bg-surface-2">
                  <td className="py-3 pr-3 text-brand font-semibold tabular-nums break-all">{e.orderNo ?? e.orderId}</td>
                  <td className="py-3 pr-3">{e.itemLabel}</td>
                  <td className="py-3 pr-3">{e.extraShipping.toLocaleString()}원</td>
                  <td className="py-3 pr-3 whitespace-nowrap">{formatDate(e.orderedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ExtraFeesPage() {
  return (
    <RequireAuth>
      <ExtraFeesContent />
    </RequireAuth>
  );
}
