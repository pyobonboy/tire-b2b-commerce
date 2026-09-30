"use client";

import { useEffect, useState } from "react";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { AdminOrderView, AdminShippingStatus } from "@/lib/admin-types";
import { formatDate } from "@/lib/formatDate";
import { isCancelledOrderStatus } from "@/lib/order-status";
import { refundReasonLabel } from "@/lib/refund-reason";

const labels: Record<AdminShippingStatus, string> = { PREPARING: "배송 준비중", TRACKING_REGISTERED: "송장번호 입력", SHIPPED: "발송 완료", DELIVERED: "배송 완료" };


export default function AdminOrdersPage() {
  const { confirm: confirmDialog } = useDialogs();
  const [orders, setOrders] = useState<AdminOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<Record<string, AdminShippingStatus>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/orders", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("주문 목록을 불러오지 못했습니다."); return response.json() as Promise<{ orders: AdminOrderView[] }>; })
      .then((data) => {
        if (!cancelled) {
          setOrders(data.orders);
          setSelectedStatus(Object.fromEntries(data.orders.map((order) => [order.id, order.shippingStatus])));
          setTracking(Object.fromEntries(data.orders.map((order) => [order.id, order.trackingNumber ?? ""])));
          setCouriers(Object.fromEntries(data.orders.map((order) => [order.id, order.courier ?? ""])));
        }
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function overrideShipping(order: AdminOrderView) {
    setBusyId(order.id);
    setError(null);
    const response = await fetch(`/api/admin/orders/${order.id}/shipping`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shippingStatus: selectedStatus[order.id], courier: couriers[order.id] ?? "", trackingNumber: tracking[order.id] ?? "", reason: reasons[order.id] ?? "" }) });
    if (!response.ok) { setError("배송 상태 오버라이드에 실패했습니다."); setBusyId(null); return; }
    const data = (await response.json()) as { order: AdminOrderView };
    setOrders((current) => current.map((item) => item.id === order.id ? data.order : item));
    setBusyId(null);
  }

  async function cancelOrderAdmin(order: AdminOrderView) {
    const confirmed = await confirmDialog({ title: `${order.orderNo ?? order.id} 주문을 취소할까요?`, description: `${order.total.toLocaleString()}원을 환불합니다.`, destructive: true });
    if (!confirmed) return;
    setBusyId(order.id);
    setError(null);
    const reason = reasons[order.id]?.trim();
    const response = await fetch(`/api/admin/orders/${order.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reason ? { reason } : {}) });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      const message = body.error === "ORDER_ALREADY_CANCELLED" ? "이미 취소된 주문입니다." : body.error === "ORDER_NOT_FOUND" ? "주문을 찾을 수 없습니다." : "주문 취소에 실패했습니다.";
      setError(message);
      setBusyId(null);
      return;
    }
    // cancelOrder(서버)는 구매자 화면용 BuyerOrderView 를 돌려주므로 그대로
    // 이 목록(AdminOrderView[])에 끼워넣으면 다음 렌더에서 buyer/seller/shipping
    // 필드가 없어 크래시한다. 대신 admin 형태로 목록을 다시 불러온다.
    const refreshed = await fetch("/api/admin/orders", { cache: "no-store" });
    if (refreshed.ok) {
      const data = (await refreshed.json()) as { orders: AdminOrderView[] };
      setOrders(data.orders);
    }
    setBusyId(null);
  }

  if (loading) return <LoadingState />;
  return (
    <div className="px-4 py-5 max-w-7xl">
      <div className="mb-5"><h1 className="text-xl font-extrabold">전체 주문</h1><p className="text-sm text-muted mt-1">판매자 주문을 조회하고 분쟁 상황에서 배송 상태를 오버라이드합니다.</p></div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {orders.length === 0 ? <div className="card py-16 text-center text-sm text-muted">주문이 없습니다.</div> : <div className="flex flex-col gap-4">{orders.map((order) => <article key={order.id} className="card p-5">{order.payment?.refundRequiredAt && <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent">환불 필요 · {order.payment.refundAmount.toLocaleString()}원 ({refundReasonLabel(order.payment.refundReason)})</div>}<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4 mb-4"><div><p className="text-xs text-muted">주문번호 {order.orderNo ?? order.id} · {formatDate(order.orderedAt)}</p><h2 className="font-bold mt-1">{order.product.manufacturer} {order.product.model}</h2><p className="text-sm text-muted mt-1">{order.product.width}/{order.product.ratio} R {order.product.rim} · DOT {order.product.dot} · {order.quantity}개</p></div><div className="text-right"><p className="text-sm font-semibold text-brand">{labels[order.shippingStatus]}</p><p className="text-xs text-muted mt-1">판매자 {order.seller.businessName} ({order.seller.code})</p></div></div><div className="grid md:grid-cols-3 gap-4 text-sm"><div><p className="text-xs text-muted mb-1">구매자</p><p className="font-medium">{order.buyer.businessName} / {order.buyer.ownerName}</p><p className="text-muted mt-1">{order.buyer.mobilePhone}</p></div><div><p className="text-xs text-muted mb-1">주문 금액</p><p className="font-bold tabular-nums">{order.total.toLocaleString()}원</p>{order.shippingFee > 0 && <p className="text-muted mt-0.5">(배송비 {order.shippingFee.toLocaleString()}원 포함)</p>}<p className="text-muted mt-1">결제 상태: {order.status}</p></div><div><p className="text-xs text-muted mb-1">관리자 오버라이드</p><div className="flex flex-col gap-2"><Select value={selectedStatus[order.id] ?? order.shippingStatus} onValueChange={(value) => setSelectedStatus((current) => ({ ...current, [order.id]: value as AdminShippingStatus }))} items={[{ value: "PREPARING", label: labels.PREPARING }, { value: "TRACKING_REGISTERED", label: labels.TRACKING_REGISTERED }, { value: "SHIPPED", label: labels.SHIPPED }, { value: "DELIVERED", label: labels.DELIVERED }]} className="seller-input" ariaLabel="배송 상태" /><input value={couriers[order.id] ?? ""} onChange={(event) => setCouriers((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="택배사" className="seller-input" /><input value={tracking[order.id] ?? ""} onChange={(event) => setTracking((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="송장번호" className="seller-input" /><input value={reasons[order.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="오버라이드 사유(선택)" className="seller-input" /><button onClick={() => void overrideShipping(order)} disabled={busyId === order.id} className="btn-outline h-10 text-sm">{busyId === order.id ? "처리 중..." : "상태 저장"}</button>{!isCancelledOrderStatus(order.status) && <button onClick={() => void cancelOrderAdmin(order)} disabled={busyId === order.id} className="btn-outline text-accent border-accent h-10 text-sm">{busyId === order.id ? "처리 중..." : "주문 취소 · 환불"}</button>}</div></div></div>{/* Task 4 — order's own shipping snapshot, not the buyer's live profile; see resolveOrderShipping in src/lib/server/admin.ts */}<div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm"><p className="text-xs text-muted mb-1">배송지</p><p className="font-medium">{order.shipping.recipientName} · {order.shipping.recipientPhone}</p><p className="text-muted mt-0.5">{order.shipping.postalCode ? `[${order.shipping.postalCode}] ` : ""}{order.shipping.address ?? "주소 미입력"} {order.shipping.addressDetail ?? ""}</p>{order.shipping.deliveryNote && <p className="text-muted mt-0.5">배송 요청사항: {order.shipping.deliveryNote}</p>}</div></article>)}</div>}
    </div>
  );
}
