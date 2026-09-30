"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, PackageSearch } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import LoadingState from "@/components/LoadingState";
import { useDialogs } from "@/components/ui/DialogProvider";
import { formatDate } from "@/lib/formatDate";
import { OrderRequestError, useOrders } from "@/lib/orders";
import { ORDER_STATUS, isCancelledOrderStatus, orderStatusRank, type OrderStatusValue } from "@/lib/order-status";
import { getStatusStyle } from "@/lib/status";
import type { FullOrder } from "@/lib/types";

// The prepare API (src/app/api/payments/toss/prepare/route.ts) caps a single
// payment at 100 orders (`z.array(...).max(100)`). Capping the selection
// here at the same number means a buyer can never build a selection the
// server would reject - they get a Korean message the moment they hit the
// limit instead of a failed request after clicking 선택 결제.
const SELECTION_CAP = 100;

// Mirrors cancelOrder's BUYER guard in src/lib/server/orders.ts exactly, so
// this button never renders when the server would reject the click:
//   - isCancelledOrderStatus refuses an order that is already cancelled
//     (ORDER_ALREADY_CANCELLED).
//   - shippedByStatusRank OR shippedByShippingStatus refuses one that has
//     shipped (CANCEL_AFTER_SHIPPING). Both axes are checked - not just rank
//     - because order.status can lag behind shippingStatus on orders that
//     predate the two being kept in lock-step; checking rank alone would let
//     this button show for an order the server still refuses.
function canBuyerCancel(order: FullOrder): boolean {
  if (isCancelledOrderStatus(order.status)) return false;
  const shippedByStatusRank =
    orderStatusRank[order.status as OrderStatusValue] >= orderStatusRank[ORDER_STATUS.SHIPPING];
  const shippedByShippingStatus = order.shippingStatus === "SHIPPED" || order.shippingStatus === "DELIVERED";
  return !shippedByStatusRank && !shippedByShippingStatus;
}

// Mirrors isOrderReturnEligible in src/lib/server/returns.ts exactly: not
// cancelled, and ranked at or past 배송완료 — this feature starts exactly
// where cancelOrder (and canBuyerCancel above) stops, rather than
// overlapping it. Only used to decide whether to show the "교환/반품 신청"
// link at all; the server re-checks this independently regardless.
function canRequestReturn(order: FullOrder): boolean {
  if (isCancelledOrderStatus(order.status)) return false;
  const rank = orderStatusRank[order.status as OrderStatusValue];
  return rank !== undefined && rank >= orderStatusRank[ORDER_STATUS.SHIPPING_COMPLETED];
}

const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "접수됨",
  APPROVED: "승인됨",
  REJECTED: "반려됨",
  COMPLETED: "완료",
};

function ReturnRequestEntry({ order }: { order: FullOrder }) {
  if (order.returnRequest) {
    const { type, status } = order.returnRequest;
    return (
      <Link
        href={`/mypage/returns/new?orderId=${encodeURIComponent(order.id)}`}
        className="text-xs text-muted underline underline-offset-2 hover:text-brand"
      >
        {type === "EXCHANGE" ? "교환" : "반품"} {RETURN_STATUS_LABEL[status] ?? status}
      </Link>
    );
  }
  if (!canRequestReturn(order)) return null;
  return (
    <Link
      href={`/mypage/returns/new?orderId=${encodeURIComponent(order.id)}`}
      className="text-xs text-brand underline underline-offset-2 hover:text-brand/80"
    >
      교환/반품 신청
    </Link>
  );
}

// 리뷰 작성 진입점. 작성 가능 조건은 서버(review.ts의 isOrderReviewable)와
// 동일한 "배송완료 이상 + 미취소"이고, 그 판정이 canRequestReturn과 정확히
// 같은 식이라 재사용한다 — 둘 다 "물건이 손에 들어온 뒤"라는 같은 바닥을
// 공유하기 때문이지 우연이 아니다. 서버가 어차피 독립적으로 재검증한다.
function ReviewEntry({ order }: { order: FullOrder }) {
  if (!canRequestReturn(order)) return null;
  return (
    <Link
      href={`/reviews/new?orderId=${encodeURIComponent(order.id)}`}
      className="text-xs text-brand underline underline-offset-2 hover:text-brand/80"
    >
      리뷰 작성
    </Link>
  );
}

function OrderActions({
  order,
  cancellingId,
  confirmingId,
  onCancel,
  onConfirm,
}: {
  order: FullOrder;
  cancellingId: string | null;
  confirmingId: string | null;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  // 결제하기 only for 입금대기 - matches the prepare API's own requirement
  // that every order it's asked to pay for is still ORDER_STATUS.PAYMENT_PENDING.
  const canPay = order.status === ORDER_STATUS.PAYMENT_PENDING;
  // 구매확정 only from 배송완료 - matches confirmPurchase's own check
  // (existing.status !== ORDER_STATUS.SHIPPING_COMPLETED throws
  // PURCHASE_CONFIRM_INVALID_STATUS).
  const canConfirm = order.status === ORDER_STATUS.SHIPPING_COMPLETED;
  const canCancel = canBuyerCancel(order);

  if (!canPay && !canConfirm && !canCancel) {
    return <span className="text-xs text-muted">-</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {canPay && (
        <Link
          href={`/orders/pay?orderId=${encodeURIComponent(order.id)}`}
          className="btn-primary h-8 px-3 text-xs inline-flex items-center"
        >
          결제하기
        </Link>
      )}
      {canConfirm && (
        <button
          type="button"
          onClick={() => onConfirm(order.id)}
          disabled={confirmingId === order.id}
          className="text-xs text-brand underline underline-offset-2 hover:text-brand/80 disabled:opacity-50"
        >
          {confirmingId === order.id ? "확정 중..." : "구매확정"}
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={() => onCancel(order.id)}
          disabled={cancellingId === order.id}
          className="text-xs text-muted underline underline-offset-2 hover:text-accent disabled:opacity-50"
        >
          {cancellingId === order.id ? "취소 중..." : "주문 취소"}
        </button>
      )}
    </div>
  );
}

function ShippingInfo({
  order,
  copiedId,
  onCopy,
}: {
  order: FullOrder;
  copiedId: string | null;
  onCopy: (order: FullOrder) => void;
}) {
  const hasCourierInfo = Boolean(order.courier || order.trackingNumber);
  return (
    <div className="text-xs leading-5">
      <p className="font-medium">{order.shippingStatusLabel ?? "-"}</p>
      {hasCourierInfo && (
        <p className="text-muted flex flex-wrap items-center gap-1">
          {order.courier && <span>{order.courier}</span>}
          {order.trackingNumber && (
            <>
              <span className="tabular-nums">{order.trackingNumber}</span>
              {/* No courier tracking URL here on purpose - this codebase has
                  no courier-code mapping, and a guessed one would be a dead
                  link. Copying the raw number is the safe affordance. */}
              <button
                type="button"
                onClick={() => onCopy(order)}
                className="text-brand underline underline-offset-2"
              >
                {copiedId === order.id ? "복사됨" : "복사"}
              </button>
            </>
          )}
        </p>
      )}
      {order.shippedAt && <p className="text-muted">발송 {formatDate(order.shippedAt)}</p>}
      {order.deliveredAt && <p className="text-muted">배송완료 {formatDate(order.deliveredAt)}</p>}
    </div>
  );
}

// Task 3/4 — the per-order shipping snapshot this buyer themselves chose at
// checkout (recipientName/recipientPhone/postalCode/address/addressDetail),
// plus any 배송 요청사항. Absent (all null) only for orders placed before
// this feature existed.
function RecipientInfo({ order }: { order: FullOrder }) {
  if (!order.recipientName && !order.address) return null;
  return (
    <div className="text-xs leading-5">
      <p className="font-medium">
        {order.recipientName} {order.recipientPhone && `· ${order.recipientPhone}`}
      </p>
      <p className="text-muted">
        {order.postalCode ? `[${order.postalCode}] ` : ""}
        {order.address ?? ""} {order.addressDetail ?? ""}
      </p>
      {order.deliveryNote && <p className="text-muted">요청사항: {order.deliveryNote}</p>}
    </div>
  );
}

function OrdersContent() {
  const { confirm: confirmDialog, alert: alertDialog } = useDialogs();
  const { orders, loading, cancelOrder, confirmPurchase } = useOrders();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const justOrdered = searchParams.get("justOrdered") === "1";

  const payableIds = useMemo(
    () => orders.filter((o) => o.status === ORDER_STATUS.PAYMENT_PENDING).map((o) => o.id),
    [orders],
  );
  const payableIdSet = useMemo(() => new Set(payableIds), [payableIds]);

  // selectedIds (raw state) can transiently hold an id that stopped being
  // payable - paid, cancelled, or expired elsewhere - between one order-list
  // update and the next explicit selection change. Rather than an effect
  // that writes the filtered result back into state (which would fire a
  // second, cascading render every time `orders` changes), every actual read
  // - rendering, the running total, the 100 cap, and the pay navigation -
  // goes through this derived set instead, so a stale id simply never shows
  // up anywhere without needing to "clean up" state imperatively.
  const effectiveSelectedIds = useMemo(
    () => new Set([...selectedIds].filter((id) => payableIdSet.has(id))),
    [selectedIds, payableIdSet],
  );

  const allPayableSelected = payableIds.length > 0 && payableIds.every((id) => effectiveSelectedIds.has(id));
  useEffect(() => {
    if (!selectAllRef.current) return;
    const someSelected = payableIds.some((id) => effectiveSelectedIds.has(id));
    selectAllRef.current.indeterminate = someSelected && !allPayableSelected;
  }, [payableIds, effectiveSelectedIds, allPayableSelected]);

  const selectedTotal = useMemo(
    () => orders.filter((o) => effectiveSelectedIds.has(o.id)).reduce((sum, o) => sum + o.total, 0),
    [orders, effectiveSelectedIds],
  );
  const atSelectionCap = effectiveSelectedIds.size >= SELECTION_CAP;

  function toggleSelect(order: FullOrder) {
    if (order.status !== ORDER_STATUS.PAYMENT_PENDING) return;
    const next = new Set(effectiveSelectedIds);
    if (next.has(order.id)) {
      next.delete(order.id);
    } else {
      if (next.size >= SELECTION_CAP) return;
      next.add(order.id);
    }
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    setSelectedIds(allPayableSelected ? new Set() : new Set(payableIds.slice(0, SELECTION_CAP)));
  }

  function handlePaySelected() {
    if (effectiveSelectedIds.size === 0) return;
    router.push(`/orders/pay?orderIds=${encodeURIComponent([...effectiveSelectedIds].join(","))}`);
  }

  async function handleCopyTracking(order: FullOrder) {
    if (!order.trackingNumber) return;
    try {
      await navigator.clipboard.writeText(order.trackingNumber);
      setCopiedId(order.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === order.id ? null : current));
      }, 1500);
    } catch {
      await alertDialog({ title: "송장번호 복사에 실패했습니다." });
    }
  }

  async function handleCancel(id: string) {
    if (!(await confirmDialog({ title: "이 주문을 취소하시겠습니까?", destructive: true }))) return;
    setCancellingId(id);
    try {
      await cancelOrder(id);
    } catch (error) {
      const code = error instanceof OrderRequestError ? error.code : "ORDER_REQUEST_FAILED";
      await alertDialog({
        title:
          code === "CANCEL_AFTER_SHIPPING"
            ? "발송이 시작된 주문은 주문 취소를 할 수 없습니다."
            : "주문 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setCancellingId(null);
    }
  }

  async function handleConfirmPurchase(id: string) {
    if (!(await confirmDialog({ title: "구매를 확정하시겠습니까?", description: "확정 후에는 취소할 수 없습니다." })))
      return;
    setConfirmingId(id);
    try {
      await confirmPurchase(id);
    } catch {
      await alertDialog({ title: "구매 확정에 실패했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-1">주문내역 / 배송조회</h1>
      <p className="text-sm text-muted mb-5">{loading ? "불러오는 중..." : `총 ${orders.length}건`}</p>

      {justOrdered && (
        <div className="mb-5 px-4 py-3 rounded-xl bg-brand/10 text-brand text-sm font-semibold flex items-center gap-2 animate-[slide-in-from-top_300ms_ease-out]">
          <CheckCircle2 size={18} className="shrink-0" />
          주문이 완료되었습니다. 입금 확인 후 순차적으로 처리됩니다.
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : orders.length === 0 ? (
        <div className="card text-center text-muted py-16 animate-[fade-slide-up_400ms_ease-out_both]">
          <PackageSearch size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          <p className="mb-4">주문 내역이 없습니다.</p>
          <Link href="/products" className="text-brand font-semibold">
            타이어 검색하러 가기
          </Link>
        </div>
      ) : (
        <>
          {payableIds.length > 0 && (
            <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPayableSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4"
                  aria-label="입금대기 주문 전체선택"
                />
                입금대기 전체선택 ({payableIds.length}건)
                {atSelectionCap && (
                  <span className="text-accent font-medium">· 최대 100건까지 한 번에 결제할 수 있습니다.</span>
                )}
              </label>
              <div className="flex items-center gap-3">
                <span className="text-sm">
                  선택 {effectiveSelectedIds.size}건 ·{" "}
                  <strong className="tabular-nums">{selectedTotal.toLocaleString()}원</strong>
                </span>
                <button
                  type="button"
                  onClick={handlePaySelected}
                  disabled={effectiveSelectedIds.size === 0}
                  className="btn-primary h-10 px-4 text-sm"
                >
                  선택 결제
                </button>
              </div>
            </div>
          )}

          {/* Desktop: detailed table, horizontal scroll (columns keep growing
              with shipping/tracking/action data, so min-w is generous). */}
          <div className="hidden lg:block card p-4 overflow-auto max-h-[calc(100vh-14rem)]">
            <table className="min-w-[1400px] w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium w-8 sticky top-0 z-10 bg-surface border-b border-border"></th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">통합주문번호</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">주문상태</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">제조사</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">주문상품</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">공장도가</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">단가</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">수량</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">추가배송비</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">배송비</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">합계금액</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">판매점</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">배송정보</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">주문일자</th>
                  <th className="py-2 pr-3 font-medium sticky top-0 z-10 bg-surface border-b border-border">관리</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border hover:bg-surface-2 align-top">
                    <td className="py-3 pr-3">
                      {o.status === ORDER_STATUS.PAYMENT_PENDING && (
                        <input
                          type="checkbox"
                          checked={effectiveSelectedIds.has(o.id)}
                          onChange={() => toggleSelect(o)}
                          className="h-4 w-4"
                          aria-label={`${o.orderNo ?? o.id} 결제 선택`}
                        />
                      )}
                    </td>
                    <td className="py-3 pr-3 text-brand font-semibold tabular-nums break-all">{o.orderNo ?? o.id}</td>
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${getStatusStyle(o.status)}`}
                      >
                        {o.status}
                      </span>
                      {o.cancelReason && (
                        <p className="text-muted mt-1 max-w-[180px] leading-4">{o.cancelReason}</p>
                      )}
                    </td>
                    <td className="py-3 pr-3">{o.manufacturer}</td>
                    <td className="py-3 pr-3">
                      <p className="font-medium">{o.model}</p>
                      <p className="text-muted">
                        {o.width}/{o.ratio}R{o.rim}
                      </p>
                    </td>
                    <td className="py-3 pr-3">{o.factoryPrice.toLocaleString()}원</td>
                    <td className="py-3 pr-3">{o.unitPrice.toLocaleString()}원</td>
                    <td className="py-3 pr-3">{o.quantity}개</td>
                    <td className="py-3 pr-3">{o.extraShipping.toLocaleString()}원</td>
                    <td className="py-3 pr-3">{(o.shippingFee ?? 0).toLocaleString()}원</td>
                    <td className="py-3 pr-3 font-semibold">{o.total.toLocaleString()}원</td>
                    <td className="py-3 pr-3">{o.sellerCode}</td>
                    <td className="py-3 pr-3 min-w-[220px]">
                      <ShippingInfo order={o} copiedId={copiedId} onCopy={(order) => void handleCopyTracking(order)} />
                      <div className="mt-1.5 pt-1.5 border-t border-border">
                        <RecipientInfo order={o} />
                      </div>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">{formatDate(o.orderedAt)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col items-end gap-1.5">
                        <OrderActions
                          order={o}
                          cancellingId={cancellingId}
                          confirmingId={confirmingId}
                          onCancel={(id) => void handleCancel(id)}
                          onConfirm={(id) => void handleConfirmPurchase(id)}
                        />
                        <ReturnRequestEntry order={o} />
                        <ReviewEntry order={o} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet: cards */}
          <div className="lg:hidden flex flex-col gap-3">
            {orders.map((o, i) => (
              <div
                key={o.id}
                className="card p-4 animate-[fade-slide-up_400ms_ease-out_both]"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    {o.status === ORDER_STATUS.PAYMENT_PENDING && (
                      <input
                        type="checkbox"
                        checked={effectiveSelectedIds.has(o.id)}
                        onChange={() => toggleSelect(o)}
                        className="mt-1 h-4 w-4 shrink-0"
                        aria-label={`${o.orderNo ?? o.id} 결제 선택`}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-muted mb-1">
                        주문번호 {o.orderNo ?? o.id} · {formatDate(o.orderedAt)}
                      </p>
                      <p className="font-semibold truncate">
                        {o.manufacturer} {o.model}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {o.width}/{o.ratio}R{o.rim} · {o.sellerCode}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-full ${getStatusStyle(o.status)}`}
                  >
                    {o.status}
                  </span>
                </div>

                {o.cancelReason && <p className="mt-2 text-xs text-muted">취소 사유 · {o.cancelReason}</p>}

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs border-t border-border pt-3">
                  <p className="text-muted">
                    공장도가 <span className="text-foreground">{o.factoryPrice.toLocaleString()}원</span>
                  </p>
                  <p className="text-muted">
                    단가 <span className="text-foreground">{o.unitPrice.toLocaleString()}원</span>
                  </p>
                  <p className="text-muted">
                    수량 <span className="text-foreground">{o.quantity}개</span>
                  </p>
                  <p className="text-muted">
                    추가배송비 <span className="text-foreground">{o.extraShipping.toLocaleString()}원</span>
                  </p>
                  <p className="text-muted">
                    배송비 <span className="text-foreground">{(o.shippingFee ?? 0).toLocaleString()}원</span>
                  </p>
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-semibold">합계금액</span>
                  <span className="text-base font-extrabold text-brand tabular-nums">
                    {o.total.toLocaleString()}원
                  </span>
                </div>

                {(o.shippingStatusLabel || o.courier || o.trackingNumber || o.recipientName) && (
                  <div className="mt-3 rounded-lg bg-surface-2 p-3 flex flex-col gap-2">
                    <ShippingInfo
                      order={o}
                      copiedId={copiedId}
                      onCopy={(order) => void handleCopyTracking(order)}
                    />
                    <RecipientInfo order={o} />
                  </div>
                )}

                <div className="mt-3 flex flex-col items-end gap-1.5 border-t border-border pt-3">
                  <OrderActions
                    order={o}
                    cancellingId={cancellingId}
                    confirmingId={confirmingId}
                    onCancel={(id) => void handleCancel(id)}
                    onConfirm={(id) => void handleConfirmPurchase(id)}
                  />
                  <ReturnRequestEntry order={o} />
                  <ReviewEntry order={o} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function OrdersDetailPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState />}>
        <OrdersContent />
      </Suspense>
    </RequireAuth>
  );
}
