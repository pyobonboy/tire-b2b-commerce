"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LoadingState from "@/components/LoadingState";
import type { SellerListingView, SellerOrderView } from "@/lib/seller-types";
import type { SellerPayoutView } from "@/lib/payout-types";
import { formatDay } from "@/lib/formatDate";

function won(value: number) {
  return `${value.toLocaleString()}원`;
}

const statusLabels: Record<SellerListingView["status"], string> = {
  DRAFT: "작성중",
  PENDING: "승인 대기",
  ACTIVE: "판매중",
  REJECTED: "반려",
  SOLDOUT: "품절",
  HIDDEN: "비노출",
};

const shippingLabels: Record<SellerOrderView["shippingStatus"], string> = {
  PREPARING: "배송 준비중",
  TRACKING_REGISTERED: "송장번호 입력",
  SHIPPED: "발송 완료",
  DELIVERED: "배송 완료",
};


export default function SellerDashboardPage() {
  const [listings, setListings] = useState<SellerListingView[]>([]);
  const [orders, setOrders] = useState<SellerOrderView[]>([]);
  const [payout, setPayout] = useState<SellerPayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/seller/listings", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("listings");
        return response.json() as Promise<{ listings: SellerListingView[] }>;
      }),
      fetch("/api/seller/orders", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("orders");
        return response.json() as Promise<{ orders: SellerOrderView[] }>;
      }),
      fetch("/api/seller/settlements", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("settlements");
        return response.json() as Promise<{ payout: SellerPayoutView }>;
      }),
    ])
      .then(([listingData, orderData, payoutData]) => {
        if (!cancelled) {
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
      active: listings.filter((listing) => listing.status === "ACTIVE").length,
      pending: listings.filter((listing) => listing.status === "PENDING").length,
      rejected: listings.filter((listing) => listing.status === "REJECTED").length,
      orders: orders.length,
    }),
    [listings, orders],
  );

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">판매자 정보를 불러오지 못했습니다.</p>
        <button className="btn-outline" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-extrabold">판매자 대시보드</h1>
          <p className="text-sm text-muted mt-1">상품과 주문 현황을 한 곳에서 관리하세요.</p>
        </div>
        <Link href="/seller/listings/new" className="btn-primary shrink-0">
          상품 등록
        </Link>
      </div>

      {payout && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-muted">이번 기간 미정산 예상액</h2>
            <Link href="/seller/settlements" className="text-xs text-brand hover:underline">
              정산 상세
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="판매대금" value={won(payout.unsettled.grossAmount)} tone="neutral" />
            <SummaryCard
              label={`수수료 (${payout.commissionRate}%)`}
              value={`-${won(payout.unsettled.commissionAmount)}`}
              tone="accent"
            />
            <SummaryCard label="실지급 예상액" value={won(payout.unsettled.netAmount)} tone="brand" />
            <SummaryCard label="미정산 주문" value={payout.unsettled.orderCount} tone="warning" />
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="판매중 상품" value={counts.active} tone="brand" />
        <SummaryCard label="승인 대기" value={counts.pending} tone="warning" />
        <SummaryCard label="반려 상품" value={counts.rejected} tone="accent" />
        <SummaryCard label="전체 주문" value={counts.orders} tone="neutral" />
      </div>

      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-5">
        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">최근 상품</h2>
            <Link href="/seller/listings" className="text-xs text-brand hover:underline">
              전체 보기
            </Link>
          </div>
          {listings.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">등록한 상품이 없습니다.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {listings.slice(0, 5).map((listing) => (
                <Link
                  key={listing.id}
                  href={`/seller/listings/${listing.id}/edit`}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3 hover:text-brand"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {listing.manufacturer} {listing.model}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {listing.width}/{listing.ratio} R {listing.rim} · DOT {listing.dot}
                    </p>
                  </div>
                  <span className="text-xs shrink-0 text-muted">{statusLabels[listing.status]}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">최근 주문</h2>
            <Link href="/seller/orders" className="text-xs text-brand hover:underline">
              전체 보기
            </Link>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">아직 주문이 없습니다.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {orders.slice(0, 5).map((order) => (
                <div key={order.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium truncate">{order.product.model}</p>
                    <span className="text-xs text-brand shrink-0">
                      {shippingLabels[order.shippingStatus]}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {formatDay(order.orderedAt)} · {order.quantity}개 · {order.total.toLocaleString()}원
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "brand" | "warning" | "accent" | "neutral";
}) {
  const toneClass = {
    brand: "text-brand",
    warning: "text-yellow-600",
    accent: "text-accent",
    neutral: "text-foreground",
  }[tone];

  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-extrabold mt-2 tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
