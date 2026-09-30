"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import LoadingState from "@/components/LoadingState";
import RequireAuth from "@/components/RequireAuth";

interface ConfirmedPayment {
  tossOrderId: string;
  status: string;
  method: string | null;
  approvedAt: string | null;
  orderCount: number;
  // 사람이 읽는 주문번호(20260825-0003). 결제 1건이 여러 주문을 덮을 수 있어
  // 배열이며, 컬럼 이전 주문만 비어 있어 그때는 tossOrderId 로 폴백한다.
  orderNos: string[];
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [payment, setPayment] = useState<ConfirmedPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const paymentKey = searchParams.get("paymentKey");
  const tossOrderId = searchParams.get("orderId");
  const amount = searchParams.get("amount");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const numericAmount = amount ? Number(amount) : NaN;
    if (!paymentKey || !tossOrderId || !Number.isInteger(numericAmount)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- validate redirect query parameters once on page entry
      setError("결제 결과에 필요한 정보가 없습니다.");
      return;
    }

    void fetch("/api/payments/toss/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId: tossOrderId, amount: numericAmount }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { payment?: ConfirmedPayment; error?: string }
          | null;
        if (!response.ok || !body?.payment) {
          throw new Error(body?.error ?? "PAYMENT_CONFIRM_FAILED");
        }
        setPayment(body.payment);
      })
      .catch((caughtError: unknown) => {
        const code = caughtError instanceof Error ? caughtError.message : null;
        if (code === "PAYMENT_AMOUNT_MISMATCH") {
          setError("결제 금액이 주문 금액과 달라 결제를 완료할 수 없습니다.");
        } else if (code === "PAYMENT_CONFIRM_PENDING_RECONCILIATION") {
          setPending(true);
          setError("결제는 정상적으로 처리되었습니다. 주문 상태 반영에 다소 시간이 걸릴 수 있으니 잠시 후 주문내역에서 확인해 주세요. 같은 결제를 다시 시도하지 마세요.");
        } else if (code === "PAYMENT_HAS_NO_ORDERS") {
          setError("이 결제에 연결된 주문을 찾을 수 없습니다. 주문내역에서 다시 시도해 주세요.");
        } else {
          setError("결제 승인에 실패했습니다. 주문내역에서 다시 시도해 주세요.");
        }
      });
  }, [amount, paymentKey, tossOrderId]);

  if (!payment && !error) return <LoadingState />;

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      {payment ? (
        <div className="card p-6 text-center">
          <CheckCircle2 size={48} className="mx-auto text-brand" />
          <h1 className="mt-4 text-xl font-extrabold">결제가 완료되었습니다</h1>
          <p className="mt-2 text-sm text-muted">
            {payment.orderCount}건의 주문이 입금완료 상태로 변경되었습니다.
          </p>
          <p className="mt-5 border-t border-border pt-5 text-sm">
            주문번호{" "}
            <span className="font-medium break-all">
              {payment.orderNos.length === 0
                ? payment.tossOrderId
                : payment.orderNos.length === 1
                  ? payment.orderNos[0]
                  : `${payment.orderNos[0]} 외 ${payment.orderNos.length - 1}건`}
            </span>
          </p>
          <Link href="/mypage/status" className="btn-primary mt-6 inline-flex h-11 items-center px-5">
            주문 상태 확인하기
          </Link>
        </div>
      ) : pending ? (
        <div className="card p-6 text-center">
          <CheckCircle2 size={48} className="mx-auto text-brand" />
          <h1 className="mt-4 text-xl font-extrabold">결제를 확인하고 있습니다</h1>
          <p className="mt-3 text-sm text-muted">{error}</p>
          <Link href="/mypage/orders" className="btn-primary mt-6 inline-flex h-11 items-center px-5">
            주문내역으로 이동
          </Link>
        </div>
      ) : (
        <div className="card p-6 text-center">
          <h1 className="text-xl font-extrabold">결제 승인에 실패했습니다</h1>
          <p className="mt-3 text-sm text-muted">{error}</p>
          <Link href="/mypage/orders" className="btn-outline mt-6 inline-flex h-11 items-center px-5">
            주문내역에서 다시 시도하기
          </Link>
        </div>
      )}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <Suspense fallback={<LoadingState />}>
        <SuccessContent />
      </Suspense>
    </RequireAuth>
  );
}
