"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import { ORDER_STATUS, isCancelledOrderStatus } from "@/lib/order-status";
import type { SellerOrderView, SellerShippingStatus } from "@/lib/seller-types";
import { formatDate } from "@/lib/formatDate";

const shippingLabels: Record<SellerShippingStatus, string> = {
  PREPARING: "배송 준비중",
  TRACKING_REGISTERED: "송장번호 입력",
  SHIPPED: "발송 완료",
  DELIVERED: "배송 완료",
};

const nextAction: Partial<Record<SellerShippingStatus, { status: SellerShippingStatus; label: string }>> = {
  PREPARING: { status: "TRACKING_REGISTERED", label: "송장번호 등록" },
  TRACKING_REGISTERED: { status: "SHIPPED", label: "발송 완료 처리" },
  SHIPPED: { status: "DELIVERED", label: "배송 완료 처리" },
};


export default function SellerOrdersPage() {
  const { prompt: promptDialog } = useDialogs();
  const [orders, setOrders] = useState<SellerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadOrders() {
    const response = await fetch("/api/seller/orders", { cache: "no-store" });
    if (!response.ok) throw new Error("주문 정보를 불러오지 못했습니다.");
    const data = (await response.json()) as { orders: SellerOrderView[] };
    setOrders(data.orders);
    setTracking((current) => ({
      ...current,
      ...Object.fromEntries(data.orders.map((order) => [order.id, order.trackingNumber ?? ""])),
    }));
    setCouriers((current) => ({
      ...current,
      ...Object.fromEntries(data.orders.map((order) => [order.id, order.courier ?? ""])),
    }));
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial API hydration is intentionally applied after mount
    loadOrders()
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

  async function updateShipping(order: SellerOrderView) {
    const action = nextAction[order.shippingStatus];
    if (!action) return;
    setBusyId(order.id);
    setError(null);
    const response = await fetch(`/api/seller/orders/${order.id}/shipping`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shippingStatus: action.status,
        courier: couriers[order.id] ?? "",
        trackingNumber: tracking[order.id] ?? "",
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      const message =
        body?.error === "TRACKING_NUMBER_REQUIRED"
          ? "송장번호를 먼저 입력해 주세요."
          : body?.error === "ORDER_UNPAID"
            ? "입금 확인 전에는 배송 처리를 할 수 없습니다."
            : body?.error === "ORDER_CANCELLED"
              ? "취소된 주문은 배송 처리를 할 수 없습니다."
              : body?.error === "ORDER_STATE_CHANGED"
                ? "주문 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요."
                : "배송 상태를 변경하지 못했습니다.";
      setError(message);
      setBusyId(null);
      return;
    }
    await loadOrders();
    setBusyId(null);
  }

  async function confirmOrder(order: SellerOrderView) {
    setBusyId(order.id);
    setError(null);
    const response = await fetch(`/api/seller/orders/${order.id}/confirm`, { method: "POST" });
    if (!response.ok) {
      setError("주문 확인 처리에 실패했습니다.");
      setBusyId(null);
      return;
    }
    await loadOrders();
    setBusyId(null);
  }

  async function cancelSellerOrder(order: SellerOrderView) {
    const reason = await promptDialog({ title: "취소 사유를 입력해 주세요.", multiline: true });
    const trimmedReason = reason?.trim();
    if (!trimmedReason) return;
    setBusyId(order.id);
    setError(null);
    const response = await fetch(`/api/seller/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: trimmedReason }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      const message =
        body?.error === "CANCEL_AFTER_SHIPPING"
          ? "이미 발송된 주문은 취소할 수 없습니다."
          : body?.error === "ORDER_ALREADY_CANCELLED"
            ? "이미 취소된 주문입니다."
            : body?.error === "CANCEL_REASON_REQUIRED"
              ? "취소 사유를 입력해 주세요."
              : "주문 취소에 실패했습니다.";
      setError(message);
      setBusyId(null);
      return;
    }
    await loadOrders();
    setBusyId(null);
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">주문 관리</h1>
        <p className="text-sm text-muted mt-1">내 상품에 접수된 주문을 확인하고 배송 상태를 처리하세요.</p>
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}

      {orders.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">아직 접수된 주문이 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => {
            const action = nextAction[order.shippingStatus];
            // order.status tracks payment/cancellation, not shipping — a
            // seller must not be able to advance shipping on an order that
            // was never paid for (still 입금대기) or is already cancelled
            // (입금전취소/입금후취소), since marking it 발송완료 would then
            // permanently block the buyer from cancelling it (cancelOrder
            // refuses once shippingStatus is SHIPPED/DELIVERED for a
            // non-admin actor). Mirrors the guard in updateSellerShipping.
            const unpaid = order.status === ORDER_STATUS.PAYMENT_PENDING;
            const cancelled = isCancelledOrderStatus(order.status);
            const shippingBlocked = unpaid || cancelled;
            const shipped = order.shippingStatus === "SHIPPED" || order.shippingStatus === "DELIVERED";
            const cancellable = !cancelled && !shipped;
            return (
              <article key={order.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4 mb-4">
                  <div>
                    <p className="text-xs text-muted">주문번호 {order.orderNo ?? order.id}</p>
                    <h2 className="font-bold mt-1">{order.product.manufacturer} {order.product.model}</h2>
                    <p className="text-sm text-muted mt-1">
                      {order.product.width}/{order.product.ratio} R {order.product.rim} · DOT {order.product.dot} · {order.quantity}개
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs font-semibold ${shippingBlocked ? "text-accent" : "text-muted"}`}>
                      {order.status}
                    </span>
                    <span className="text-sm font-semibold text-brand">{shippingLabels[order.shippingStatus]}</span>
                    {/*
                      주문확인 has no shipping trigger (see
                      SHIPPING_STATUS_TO_ORDER_STATUS in order-status.ts), so
                      it's its own explicit action here, only valid from
                      입금완료 - matching confirmSellerOrder's server-side
                      check. Skipping straight to a shipping action below
                      (e.g. registering tracking) without confirming first is
                      allowed; it just advances order.status past 주문확인.
                    */}
                    {order.status === ORDER_STATUS.PAYMENT_COMPLETED && (
                      <button
                        onClick={() => void confirmOrder(order)}
                        disabled={busyId === order.id}
                        className="btn-primary h-8 px-3 text-xs mt-1"
                      >
                        {busyId === order.id ? "처리 중..." : "주문확인"}
                      </button>
                    )}
                    {cancellable && (
                      <button
                        onClick={() => void cancelSellerOrder(order)}
                        disabled={busyId === order.id}
                        className="btn-outline text-accent border-accent h-10 text-sm mt-1"
                      >
                        {busyId === order.id ? "처리 중..." : "주문 취소"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted mb-1">구매자</p>
                    <p className="font-medium">{order.buyer.businessName} / {order.buyer.ownerName}</p>
                    <p className="text-muted mt-1">{order.buyer.mobilePhone}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">주문 금액</p>
                    <p className="font-bold tabular-nums">{order.total.toLocaleString()}원</p>
                    {order.shippingFee > 0 && (
                      <p className="text-muted mt-0.5">(배송비 {order.shippingFee.toLocaleString()}원 포함)</p>
                    )}
                    <p className="text-muted mt-1">{formatDate(order.orderedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">배송 처리</p>
                    <div className="flex flex-col gap-2">
                      <input
                        value={couriers[order.id] ?? ""}
                        onChange={(event) => setCouriers((current) => ({ ...current, [order.id]: event.target.value }))}
                        placeholder="택배사"
                        className="seller-input"
                        disabled={!action || shippingBlocked}
                      />
                      <input
                        value={tracking[order.id] ?? ""}
                        onChange={(event) => setTracking((current) => ({ ...current, [order.id]: event.target.value }))}
                        placeholder="송장번호"
                        className="seller-input"
                        disabled={!action || shippingBlocked}
                      />
                      {shippingBlocked ? (
                        <p className="text-xs text-accent">
                          {unpaid ? "입금 확인 전에는 배송 처리를 할 수 없습니다." : "취소된 주문은 배송 처리를 할 수 없습니다."}
                        </p>
                      ) : (
                        action && (
                          <button onClick={() => void updateShipping(order)} disabled={busyId === order.id} className="btn-primary h-10 text-sm">
                            {busyId === order.id ? "처리 중..." : action.label}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Task 4 — the order's own shipping snapshot, not the
                    buyer's live profile: a business with several branches may
                    have this order going somewhere other than their account
                    address, and that must stay fixed even if the profile
                    address changes later. See resolveOrderShipping in
                    src/lib/server/seller.ts. */}
                <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                  <p className="text-xs text-muted mb-1">배송지</p>
                  <p className="font-medium">
                    {order.shipping.recipientName} · {order.shipping.recipientPhone}
                  </p>
                  <p className="text-muted mt-0.5">
                    {order.shipping.postalCode ? `[${order.shipping.postalCode}] ` : ""}
                    {order.shipping.address ?? "주소 미입력"} {order.shipping.addressDetail ?? ""}
                  </p>
                  {order.shipping.deliveryNote && (
                    <p className="text-muted mt-0.5">배송 요청사항: {order.shipping.deliveryNote}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
