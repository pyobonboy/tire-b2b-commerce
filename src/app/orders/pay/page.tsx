"use client";

import { loadTossPayments, type TossPaymentsPayment } from "@tosspayments/tosspayments-sdk";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import LoadingState from "@/components/LoadingState";
import RequireAuth from "@/components/RequireAuth";
import { useAuth } from "@/lib/auth";

interface PreparePaymentResponse {
  tossOrderId: string;
  amount: number;
  orderName: string;
  clientKey: string;
}

function getErrorMessage(error: string | undefined) {
  switch (error) {
    case "ORDERS_MUST_BE_OWNED_AND_PAYMENT_PENDING":
      return "본인의 입금대기 주문만 결제할 수 있습니다.";
    case "TOSS_CLIENT_KEY_MISSING":
      return "결제 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.";
    default:
      return "결제 준비에 실패했습니다. 주문내역에서 다시 시도해 주세요.";
  }
}

function PaymentContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const paymentRef = useRef<TossPaymentsPayment | null>(null);
  const [preparedPayment, setPreparedPayment] = useState<PreparePaymentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orderIds = useMemo(() => {
    const repeatedIds = searchParams.getAll("orderId");
    if (repeatedIds.length > 0) return [...new Set(repeatedIds)];

    const commaSeparatedIds = searchParams.get("orderIds");
    return commaSeparatedIds
      ? [...new Set(commaSeparatedIds.split(",").map((id) => id.trim()).filter(Boolean))]
      : [];
  }, [searchParams]);
  const orderIdsKey = orderIds.join(",");

  useEffect(() => {
    let cancelled = false;

    if (!user?.id) return () => { cancelled = true; };

    if (orderIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect invalid URL state in the client UI
      setError("결제할 주문을 찾을 수 없습니다.");
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError(null);
    setPreparedPayment(null);
    paymentRef.current = null;

    void (async () => {
      const response = await fetch("/api/payments/toss/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      const body = (await response.json().catch(() => null)) as
        | (PreparePaymentResponse & { error?: string })
        | null;
      if (!response.ok) throw new Error(body?.error ?? "PAYMENT_PREPARE_FAILED");

      const tossPayments = await loadTossPayments(body!.clientKey);
      const payment = tossPayments.payment({ customerKey: user.id });

      if (cancelled) return;
      setPreparedPayment(body as PreparePaymentResponse);
      setLoading(false);
      paymentRef.current = payment;
    })().catch((caughtError: unknown) => {
      if (cancelled) return;
      const code = caughtError instanceof Error ? caughtError.message : "PAYMENT_PREPARE_FAILED";
      setError(getErrorMessage(code));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [orderIds, orderIdsKey, user?.id]);

  async function handlePayment() {
    if (!preparedPayment || !paymentRef.current || !user) return;

    setRequesting(true);
    setError(null);
    try {
      await paymentRef.current.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: preparedPayment.amount },
        orderId: preparedPayment.tossOrderId,
        orderName: preparedPayment.orderName,
        customerName: user.businessName,
        successUrl: `${window.location.origin}/orders/pay/success`,
        failUrl: `${window.location.origin}/orders/pay/fail`,
      });
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "결제 요청에 실패했습니다.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold mb-2">온라인 결제</h1>
      <p className="text-sm text-muted mb-6">토스페이먼츠 결제창에서 결제를 진행해 주세요.</p>

      {loading && <LoadingState />}

      {error && (
        <div className="card p-5 text-sm">
          <p className="text-accent font-semibold">{error}</p>
          <Link href="/mypage/orders" className="btn-outline mt-4 inline-flex h-10 items-center px-4">
            주문내역으로 돌아가기
          </Link>
        </div>
      )}

      {!loading && !error && preparedPayment && (
        <div className="card p-6">
          <p className="text-sm text-muted">결제상품</p>
          <p className="mt-1 text-lg font-bold">{preparedPayment.orderName}</p>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-5">
            <span className="font-semibold">결제금액</span>
            <strong className="text-xl tabular-nums">
              {preparedPayment.amount.toLocaleString()}원
            </strong>
          </div>
          <button
            type="button"
            onClick={() => void handlePayment()}
            disabled={requesting}
            className="btn-primary mt-6 h-12 w-full"
          >
            {requesting ? "결제창을 여는 중..." : "토스페이먼츠로 결제하기"}
          </button>
          <p className="mt-3 text-xs leading-5 text-muted">
            주문 금액은 서버에서 다시 확인하며, 결제가 완료되면 주문 상태가 자동으로 입금완료로 바뀝니다.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            결제를 진행하면 <Link href="/terms" className="underline hover:text-brand">이용약관</Link>과{" "}
            <Link href="/refund-policy" className="underline hover:text-brand">
              청약철회 및 교환·반품 정책
            </Link>
            에 동의한 것으로 간주됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

export default function PaymentPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <Suspense fallback={<LoadingState />}>
        <PaymentContent />
      </Suspense>
    </RequireAuth>
  );
}
