"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LoadingState from "@/components/LoadingState";
import type { AdminListingView, AdminOrderView, AdminSellerView } from "@/lib/admin-types";
import type { AdminPayoutView } from "@/lib/payout-types";
import { formatDay } from "@/lib/formatDate";

function won(value: number) {
  return `${value.toLocaleString()}원`;
}

const shippingLabels: Record<AdminOrderView["shippingStatus"], string> = {
  PREPARING: "배송 준비중",
  TRACKING_REGISTERED: "송장번호 입력",
  SHIPPED: "발송 완료",
  DELIVERED: "배송 완료",
};


export default function AdminDashboardPage() {
  const [sellers, setSellers] = useState<AdminSellerView[]>([]);
  const [listings, setListings] = useState<AdminListingView[]>([]);
  const [orders, setOrders] = useState<AdminOrderView[]>([]);
  const [payout, setPayout] = useState<AdminPayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/sellers", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("sellers");
        return response.json() as Promise<{ sellers: AdminSellerView[] }>;
      }),
      fetch("/api/admin/listings?status=PENDING", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("listings");
        return response.json() as Promise<{ listings: AdminListingView[] }>;
      }),
      fetch("/api/admin/orders", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("orders");
        return response.json() as Promise<{ orders: AdminOrderView[] }>;
      }),
      fetch("/api/admin/settlements", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("settlements");
        return response.json() as Promise<{ payout: AdminPayoutView }>;
      }),
    ])
      .then(([sellerData, listingData, orderData, payoutData]) => {
        if (!cancelled) {
          setSellers(sellerData.sellers);
          setListings(listingData.listings);
          setOrders(orderData.orders);
          setPayout(payoutData.payout);
        }
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

  const counts = useMemo(
    () => ({
      pendingSellers: sellers.filter((seller) => seller.status === "PENDING").length,
      activeSellers: sellers.filter((seller) => seller.status === "ACTIVE").length,
      pendingListings: listings.length,
      orders: orders.length,
    }),
    [sellers, listings, orders],
  );

  // 기간별 거래액/수수료 수입/정산 대기액: the *unsettled* portion of the
  // dashboard's default (current-month) period, summed across every seller —
  // the same live figures the admin settlement screen shows per seller (see
  // getAdminUnsettledBySeller in payout.ts), just totalled here. This is
  // deliberately the outstanding-workload view (it shrinks toward zero as the
  // admin confirms settlements for the period), not cumulative historical
  // revenue — a settlement's own confirmed numbers live in 정산 관리's 정산
  // 내역 list once claimed, per the "never display a computed figure the
  // database doesn't back once confirmed" rule.
  const financials = useMemo(
    () =>
      (payout?.unsettledBySeller ?? []).reduce(
        (sum, row) => ({
          grossAmount: sum.grossAmount + row.grossAmount,
          commissionAmount: sum.commissionAmount + row.commissionAmount,
          netAmount: sum.netAmount + row.netAmount,
        }),
        { grossAmount: 0, commissionAmount: 0, netAmount: 0 },
      ),
    [payout],
  );

  if (loading) return <LoadingState />;
  if (error) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">관리자 정보를 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>다시 시도</button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">관리자 대시보드</h1>
        <p className="text-sm text-muted mt-1">본사 운영 현황과 검토가 필요한 항목을 확인하세요.</p>
      </div>

      {payout && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-muted">
              이번 달 거래 현황 ({formatDay(payout.period.start)} ~ {formatDay(payout.period.end)})
            </h2>
            <Link href="/admin/settlements" className="text-xs text-brand hover:underline">
              정산 관리
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <SummaryCard label="기간별 거래액" value={won(financials.grossAmount)} tone="neutral" />
            <SummaryCard label="수수료 수입" value={won(financials.commissionAmount)} tone="brand" />
            <SummaryCard label="정산 대기액" value={won(financials.netAmount)} tone="accent" />
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="승인 대기 가맹점" value={counts.pendingSellers} tone="warning" />
        <SummaryCard label="활성 가맹점" value={counts.activeSellers} tone="brand" />
        <SummaryCard label="상품 심사 대기" value={counts.pendingListings} tone="accent" />
        <SummaryCard label="전체 주문" value={counts.orders} tone="neutral" />
      </div>

      <div className="grid xl:grid-cols-2 gap-5">
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">승인 대기 가맹점</h2>
            <Link href="/admin/sellers?status=PENDING" className="text-xs text-brand hover:underline">전체 보기</Link>
          </div>
          {sellers.filter((seller) => seller.status === "PENDING").length === 0 ? (
            <p className="text-sm text-muted text-center py-8">승인 대기 가맹점이 없습니다.</p>
          ) : (
            <div className="divide-y divide-border">
              {sellers.filter((seller) => seller.status === "PENDING").slice(0, 5).map((seller) => (
                <Link key={seller.id} href={`/admin/sellers/${seller.id}`} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 hover:text-brand">
                  <div><p className="font-medium">{seller.user.businessName}</p><p className="text-xs text-muted mt-1">{seller.code} · {seller.user.ownerName}</p></div>
                  <span className="text-xs text-yellow-600">승인 대기</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">상품 심사 대기</h2>
            <Link href="/admin/listings?status=PENDING" className="text-xs text-brand hover:underline">전체 보기</Link>
          </div>
          {listings.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">심사 대기 상품이 없습니다.</p>
          ) : (
            <div className="divide-y divide-border">
              {listings.slice(0, 5).map((listing) => (
                <Link key={listing.id} href={`/admin/listings/${listing.id}`} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 hover:text-brand">
                  <div><p className="font-medium truncate">{listing.model}</p><p className="text-xs text-muted mt-1">{listing.seller.businessName} · {listing.dot}</p></div>
                  <span className="text-xs text-accent">심사 필요</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">최근 주문</h2>
            <Link href="/admin/orders" className="text-xs text-brand hover:underline">전체 보기</Link>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">주문이 없습니다.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-x-6 divide-y divide-border md:divide-y-0">
              {orders.slice(0, 6).map((order) => (
                <div key={order.id} className="py-3 first:pt-0 md:first:pt-3 flex items-center justify-between gap-3 border-b border-border">
                  <div className="min-w-0"><p className="font-medium truncate">{order.product.model}</p><p className="text-xs text-muted mt-1">{order.seller.businessName} · {formatDay(order.orderedAt)}</p></div>
                  <span className="text-xs text-brand shrink-0">{shippingLabels[order.shippingStatus]}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone: "brand" | "warning" | "accent" | "neutral" }) {
  const toneClass = { brand: "text-brand", warning: "text-yellow-600", accent: "text-accent", neutral: "text-foreground" }[tone];
  return <div className="card p-4"><p className="text-xs text-muted">{label}</p><p className={`text-2xl font-extrabold mt-2 tabular-nums ${toneClass}`}>{value}</p></div>;
}
