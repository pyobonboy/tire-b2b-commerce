"use client";

import { useEffect, useState } from "react";
import type {
  AdminPayoutSettlementView,
  AdminPayoutView,
  AdminUnsettledSellerRow,
  PayoutStatus,
} from "@/lib/payout-types";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
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

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Mirrors getCurrentMonthPeriod in payout.ts (1st of this month through
// today) so the picker's initial values match what the server would use if
// no period were supplied at all.
function defaultPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: toDateInputValue(start), end: toDateInputValue(now) };
}

// Plain fetch-and-parse, no component state touched — kept free of setState
// so it can be called directly from the mount effect below without tripping
// react-hooks/set-state-in-effect (that rule flags a *synchronous* setState
// call reachable from an effect body; reload(), defined inside the
// component, deliberately is not called from the effect for the same
// reason — see its own comment).
async function fetchPayout(start: string, end: string): Promise<AdminPayoutView> {
  const response = await fetch(`/api/admin/settlements?periodStart=${start}&periodEnd=${end}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("정산 정보를 불러오지 못했습니다.");
  const data = (await response.json()) as { payout: AdminPayoutView };
  return data.payout;
}

export default function AdminSettlementsPage() {
  const { confirm: confirmDialog } = useDialogs();
  const initial = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [payout, setPayout] = useState<AdminPayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPayout(initial.start, initial.end)
      .then((data) => {
        if (!cancelled) setPayout(data);
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
    // Mount-only, matching every other dashboard page's fetch-on-mount
    // effect in this codebase — re-fetching on a period change is the 조회
    // button's job (via reload below), not this effect's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Used by the 조회 button, the retry button, and after every confirm/
  // mark-paid action below — always from an event handler, never from an
  // effect, so (unlike the mount effect above) starting with a synchronous
  // setLoading/setLoadError call here is fine.
  function reload(start: string, end: string) {
    setLoading(true);
    setLoadError(false);
    return fetchPayout(start, end)
      .then((data) => setPayout(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  async function confirmSettlement(row: AdminUnsettledSellerRow) {
    const confirmed = await confirmDialog({
      title: `${row.businessName} (${row.sellerCode}) 판매자의 ${periodStart} ~ ${periodEnd} 정산을 확정하시겠습니까?`,
      description: `대상 주문 ${row.orderCount}건 · 실지급액 ${row.netAmount.toLocaleString()}원`,
    });
    if (!confirmed) return;

    setActionError(null);
    setBusyId(row.sellerId);
    try {
      const response = await fetch("/api/admin/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: row.sellerId, periodStart, periodEnd }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setActionError(
          body?.error === "NO_SETTLEABLE_ORDERS"
            ? "그 사이 정산할 주문이 없어졌습니다. 목록을 새로고침했습니다."
            : body?.error === "SETTLEMENT_CLAIM_CONFLICT"
              ? "다른 작업과 충돌했습니다. 목록을 새로고침했으니 다시 시도해 주세요."
              : "정산 확정에 실패했습니다.",
        );
      }
    } finally {
      setBusyId(null);
      await reload(periodStart, periodEnd);
    }
  }

  async function markPaid(settlement: AdminPayoutSettlementView) {
    const confirmed = await confirmDialog({
      title: `${settlement.seller.businessName} 판매자에게 ${settlement.netAmount.toLocaleString()}원을 지급 완료 처리하시겠습니까?`,
      description: "이 작업은 되돌릴 수 없습니다.",
      destructive: true,
    });
    if (!confirmed) return;

    setActionError(null);
    setBusyId(settlement.id);
    try {
      const response = await fetch(`/api/admin/settlements/${settlement.id}/pay`, { method: "POST" });
      if (!response.ok) {
        setActionError("지급 완료 처리에 실패했습니다.");
      }
    } finally {
      setBusyId(null);
      await reload(periodStart, periodEnd);
    }
  }

  if (loading && !payout) return <LoadingState />;

  if (loadError || !payout) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">정산 정보를 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => void reload(periodStart, periodEnd)}>
          다시 시도
        </button>
      </div>
    );
  }

  const { unsettledBySeller, settlements } = payout;
  const totals = unsettledBySeller.reduce(
    (sum, row) => ({
      grossAmount: sum.grossAmount + row.grossAmount,
      commissionAmount: sum.commissionAmount + row.commissionAmount,
      netAmount: sum.netAmount + row.netAmount,
    }),
    { grossAmount: 0, commissionAmount: 0, netAmount: 0 },
  );

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">정산 관리</h1>
        <p className="text-sm text-muted mt-1">기간별 미정산 금액을 확인하고 판매자 정산을 확정·지급 처리합니다.</p>
      </div>

      <div className="card p-4 mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">시작일</span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="seller-input"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted mb-1">종료일</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="seller-input"
          />
        </label>
        <button className="btn-primary h-10 px-5" onClick={() => void reload(periodStart, periodEnd)}>
          조회
        </button>
        {loading && <span className="text-xs text-muted">불러오는 중...</span>}
      </div>

      {actionError && (
        <div className="card p-3 mb-5 text-sm text-accent border-accent/40">{actionError}</div>
      )}

      <section className="mb-6">
        <h2 className="text-sm font-bold text-muted mb-2">
          선택 기간 미정산 합계 ({formatDate(payout.period.start)} ~ {formatDate(payout.period.end)})
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="card p-4">
            <p className="text-xs text-muted">거래액</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums">{won(totals.grossAmount)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">수수료 수입</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums text-brand">{won(totals.commissionAmount)}</p>
          </div>
          <div className="card p-4 col-span-2 lg:col-span-1">
            <p className="text-xs text-muted">정산 대기액 (실지급 기준)</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums text-accent">{won(totals.netAmount)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">미정산 판매자</p>
            <p className="text-xl font-extrabold mt-2 tabular-nums">{unsettledBySeller.length}</p>
          </div>
        </div>

        {unsettledBySeller.length === 0 ? (
          <div className="card p-10 text-center text-muted text-sm">선택한 기간에 미정산 주문이 없습니다.</div>
        ) : (
          <div className="card p-4 overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">판매자</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">주문 건수</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">거래액</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">수수료율</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">수수료</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">정산 조정</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">실지급액</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {unsettledBySeller.map((row) => (
                  <tr key={row.sellerId} className="border-b border-border hover:bg-surface-2">
                    <td className="py-3 pr-3">
                      {row.businessName}
                      <p className="text-xs text-muted mt-1">{row.sellerCode}</p>
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{row.orderCount.toLocaleString()}</td>
                    <td className="py-3 pr-3 tabular-nums">{won(row.grossAmount)}</td>
                    <td className="py-3 pr-3 tabular-nums">{row.commissionRate}%</td>
                    <td className="py-3 pr-3 tabular-nums">{won(row.commissionAmount)}</td>
                    <td className="py-3 pr-3 tabular-nums">
                      {row.adjustmentAmount === 0 ? "-" : won(row.adjustmentAmount)}
                    </td>
                    <td className="py-3 pr-3 tabular-nums font-semibold">{won(row.netAmount)}</td>
                    <td className="py-3 pr-3">
                      <button
                        className="btn-outline h-8 px-3 text-xs disabled:opacity-50"
                        disabled={busyId === row.sellerId}
                        onClick={() => void confirmSettlement(row)}
                      >
                        정산 확정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-muted mb-2">정산 내역 (전체 판매자)</h2>
        {settlements.length === 0 ? (
          <div className="card p-10 text-center text-muted text-sm">확정된 정산 내역이 없습니다.</div>
        ) : (
          <div className="card p-4 overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">판매자</th>
                  <th className="py-2 pr-3 font-medium">정산 기간</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">거래액</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">수수료</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">실지급액</th>
                  <th className="py-2 pr-3 font-medium">상태</th>
                  <th className="py-2 pr-3 font-medium whitespace-nowrap">확정일 / 지급일</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {settlements.map((settlement) => (
                  <tr key={settlement.id} className="border-b border-border hover:bg-surface-2">
                    <td className="py-3 pr-3">
                      {settlement.seller.businessName}
                      <p className="text-xs text-muted mt-1">{settlement.seller.code}</p>
                    </td>
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
                    <td className="py-3 pr-3">
                      {settlement.status === "CONFIRMED" && (
                        <button
                          className="btn-outline h-8 px-3 text-xs disabled:opacity-50"
                          disabled={busyId === settlement.id}
                          onClick={() => void markPaid(settlement)}
                        >
                          지급 완료
                        </button>
                      )}
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
