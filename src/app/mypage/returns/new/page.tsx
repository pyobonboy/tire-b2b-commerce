"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import RequireAuth from "@/components/RequireAuth";
import Select from "@/components/ui/Select";
import { formatDate } from "@/lib/formatDate";
import type { ReturnEligibleOrderView, ReturnRequestOrderContext } from "@/lib/return-types";

// Buyer-facing 교환/반품 신청 flow. Mirrors /reviews/new's architecture
// exactly (same picker-or-deep-link shape, same "fetch context, branch on
// eligible/existing" pattern) — see src/lib/server/returns.ts for why the
// two features share the same eligibility rule. Reached two ways:
//   - /mypage/returns/new?orderId=X : file (or view the status of) the
//     request for that specific order. The entry point on /mypage/orders
//     always links here.
//   - /mypage/returns/new           : pick which eligible order to start
//     from first, then continues into the same flow above.

const REASON_OPTIONS = ["단순변심", "상품 불량/파손", "오배송(주문과 다른 상품)", "기타"];

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "접수됨 · 판매자 확인 대기중",
  APPROVED: "승인됨 · 처리 진행중",
  REJECTED: "반려됨",
  COMPLETED: "완료",
};

function OrderPicker() {
  const [orders, setOrders] = useState<ReturnEligibleOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/returns/eligible-orders", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("주문 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ orders: ReturnEligibleOrderView[] }>;
      })
      .then((data) => {
        if (!cancelled) setOrders(data.orders);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-accent">{error}</p>;
  if (!orders) return <LoadingState />;
  if (orders.length === 0) {
    return (
      <div className="card py-16 text-center text-sm text-muted">
        교환/반품을 신청할 수 있는 주문이 없습니다.
        <br />
        배송완료 이후의 주문에 대해서만 신청할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => (
        <Link
          key={order.orderId}
          href={`/mypage/returns/new?orderId=${encodeURIComponent(order.orderId)}`}
          className="card p-4 flex items-center justify-between gap-3 card-hover"
        >
          <div className="min-w-0">
            <p className="font-semibold truncate">
              {order.manufacturer} {order.model}
            </p>
            <p className="text-xs text-muted mt-1">
              {order.width}/{order.ratio} R {order.rim} · {order.sellerCode} · {formatDate(order.orderedAt)}
            </p>
          </div>
          <span className="text-brand text-sm font-semibold shrink-0">신청하기 →</span>
        </Link>
      ))}
    </div>
  );
}

function RequestStatusView({ context }: { context: ReturnRequestOrderContext }) {
  const request = context.returnRequest;
  if (!request) return null;
  return (
    <div className="card p-5">
      <div className="pb-4 mb-4 border-b border-border">
        <p className="font-semibold">
          {context.order.manufacturer} {context.order.model}
        </p>
        <p className="text-xs text-muted mt-1">
          {context.order.width}/{context.order.ratio} R {context.order.rim} · {context.order.sellerCode} ·{" "}
          {formatDate(context.order.orderedAt)}
        </p>
      </div>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">신청 구분</span>
          <span className="font-semibold">{request.type === "EXCHANGE" ? "교환" : "반품"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">진행 상태</span>
          <span className="font-semibold text-brand">{STATUS_LABEL[request.status] ?? request.status}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">신청 사유</span>
          <span className="font-medium">{request.reason}</span>
        </div>
        {request.detail && (
          <div>
            <p className="text-muted mb-1">상세 내용</p>
            <p className="whitespace-pre-wrap">{request.detail}</p>
          </div>
        )}
        {request.status === "REJECTED" && request.rejectReason && (
          <div className="rounded-lg bg-accent/10 p-3">
            <p className="text-accent font-semibold text-xs mb-1">반려 사유</p>
            <p className="text-sm">{request.rejectReason}</p>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted pt-2 border-t border-border">
          <span>신청일 {formatDate(request.requestedAt)}</span>
          {request.processedAt && <span>처리일 {formatDate(request.processedAt)}</span>}
        </div>
      </div>
    </div>
  );
}

function RequestForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [type, setType] = useState<"EXCHANGE" | "RETURN">("RETURN");
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, type, reason, detail }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setSubmitError(
          body?.error === "ORDER_NOT_ELIGIBLE"
            ? "배송완료 이후, 취소되지 않은 주문만 교환/반품을 신청할 수 있습니다."
            : body?.error === "RETURN_REQUEST_ALREADY_EXISTS"
              ? "이미 이 주문에 대한 교환/반품 신청이 접수되어 있습니다."
              : "신청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium mb-2">신청 구분</p>
        <div className="flex gap-2" role="radiogroup" aria-label="신청 구분">
          {(["RETURN", "EXCHANGE"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => setType(value)}
              className={`h-10 px-4 rounded-lg text-sm font-semibold border transition-colors ${
                type === value ? "bg-brand text-white border-brand" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {value === "RETURN" ? "반품" : "교환"}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">사유</span>
        <Select
          value={reason}
          onValueChange={setReason}
          items={REASON_OPTIONS.map((option) => ({ value: option, label: option }))}
          className="h-10 px-3 rounded-lg border border-border bg-background"
          ariaLabel="사유"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">상세 내용 (선택)</span>
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          maxLength={1000}
          rows={5}
          placeholder="상품 상태, 요청 사항 등을 자세히 남겨주시면 처리에 도움이 됩니다."
          className="px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
        />
      </label>
      {submitError && <p className="text-sm text-accent font-medium">{submitError}</p>}
      <button type="submit" disabled={submitting} className="btn-primary h-11 self-end px-6 disabled:opacity-60">
        {submitting ? "신청 중..." : "신청하기"}
      </button>
    </form>
  );
}

function ReturnRequestContent({ orderId }: { orderId: string }) {
  const [context, setContext] = useState<ReturnRequestOrderContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function load() {
    return fetch(`/api/returns/order/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("주문 정보를 불러오지 못했습니다.");
        return response.json() as Promise<ReturnRequestOrderContext>;
      })
      .then((data) => setContext(data));
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((reason: Error) => {
      if (!cancelled) setLoadError(reason.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orderId is the effective key; load() is stable per render
  }, [orderId]);

  if (loadError) return <p className="text-sm text-accent">{loadError}</p>;
  if (!context) return <LoadingState />;

  // Right after a successful submit, `load()` is already in flight
  // (onDone below) but hasn't resolved yet — show a lightweight loading
  // state instead of the form (which would otherwise flash back onto
  // screen since `context` itself hasn't updated yet).
  if (submitted && !context.returnRequest) return <LoadingState />;

  if (context.returnRequest) {
    return <RequestStatusView context={context} />;
  }

  if (!context.eligible) {
    return (
      <div className="card py-16 text-center text-sm text-muted">
        이 주문은 아직 교환/반품을 신청할 수 없습니다.
        <br />
        배송완료 이후, 취소되지 않은 주문에서만 신청할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="pb-4 mb-4 border-b border-border">
        <p className="font-semibold">
          {context.order.manufacturer} {context.order.model}
        </p>
        <p className="text-xs text-muted mt-1">
          {context.order.width}/{context.order.ratio} R {context.order.rim} · {context.order.sellerCode} ·{" "}
          {formatDate(context.order.orderedAt)}
        </p>
      </div>
      <RequestForm
        orderId={orderId}
        onDone={() => {
          setSubmitted(true);
          void load();
        }}
      />
    </div>
  );
}

function NewReturnRequestContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto">
      <Link href="/mypage/orders" className="text-sm text-muted mb-4 inline-flex items-center gap-0.5">
        <ChevronLeft size={16} /> 주문내역으로
      </Link>
      <h1 className="text-xl font-extrabold mb-1">{orderId ? "교환/반품 신청" : "교환/반품 신청할 주문 선택"}</h1>
      <p className="text-sm text-muted mb-5">
        {orderId
          ? "배송완료된 주문에 대해 교환 또는 반품을 신청할 수 있습니다."
          : "교환/반품을 신청하고 싶은 주문을 선택해 주세요."}
      </p>
      {orderId ? <ReturnRequestContent orderId={orderId} /> : <OrderPicker />}
    </div>
  );
}

export default function NewReturnRequestPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <Suspense fallback={<LoadingState />}>
        <NewReturnRequestContent />
      </Suspense>
    </RequireAuth>
  );
}
