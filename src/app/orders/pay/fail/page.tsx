"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import LoadingState from "@/components/LoadingState";
import RequireAuth from "@/components/RequireAuth";

// This page is reached only via Toss's own redirect to `failUrl` (see
// src/app/orders/pay/page.tsx), which appends `?code=...&message=...` chosen
// entirely by Toss's payment window. Nothing stops a third party from
// crafting the same URL by hand with an arbitrary `message` and sending it to
// a buyer — React escapes it, so it is not XSS, but rendering that text
// verbatim inside this app's own trusted-looking card is a clean phishing
// surface (e.g. "결제가 실패했습니다. 아래 계좌로 입금해주세요..."). So we never
// render the raw `message` query param; we only ever show copy we wrote
// ourselves, chosen by looking up `code` in the map below.
//
// The installed @tosspayments/tosspayments-sdk package does not ship an
// authoritative list of these ERROR_CODE values anywhere (the type
// definitions only document the redirect shape as
// `{failUrl}?code={ERROR_CODE}&message={ERROR_MESSAGE}&orderId={ORDER_ID}`,
// see node_modules/@tosspayments/tosspayments-sdk/types/index.d.ts). The
// codes below are the common, widely-documented Toss failure codes for
// card payments; they have not been verified against a live payment in this
// change (no Toss credentials/browser session available here). Anything not
// in this map - including codes that turn out to be real but unlisted -
// falls through to the generic message, which is always safe.
const KNOWN_FAILURE_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제가 취소되었습니다.",
  PAY_PROCESS_ABORTED: "결제 진행 중 오류가 발생하여 결제가 중단되었습니다.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 거절했습니다. 다른 카드로 다시 시도해 주세요.",
  INVALID_CARD_EXPIRATION: "카드 유효기간이 올바르지 않습니다.",
  INVALID_STOPPED_CARD: "정지된 카드입니다. 카드사에 문의해 주세요.",
  EXCEED_MAX_DAILY_PAYMENT_COUNT: "일일 결제 가능 횟수를 초과했습니다.",
  EXCEED_MAX_PAYMENT_AMOUNT: "결제 가능 금액을 초과했습니다.",
  INVALID_CARD_NUMBER: "카드 번호가 올바르지 않습니다.",
  NOT_AVAILABLE_PAYMENT: "현재 이용할 수 없는 결제수단입니다.",
  INVALID_UNREGISTERED_SUBMALL: "결제 설정이 올바르지 않습니다. 관리자에게 문의해 주세요.",
};

const GENERIC_FAILURE_MESSAGE = "결제가 취소되었거나 결제 과정에서 문제가 발생했습니다.";

// Toss's own codes are short upper-snake-case tokens (see the examples
// above). Constraining the raw code to that shape - even though we no
// longer render `message` - keeps this field from ever being (ab)used to
// carry a sentence if we display it for support purposes.
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

function resolveFailureMessage(code: string | null) {
  if (code && Object.prototype.hasOwnProperty.call(KNOWN_FAILURE_MESSAGES, code)) {
    return KNOWN_FAILURE_MESSAGES[code];
  }
  return GENERIC_FAILURE_MESSAGE;
}

function FailContent() {
  const searchParams = useSearchParams();
  const rawCode = searchParams.get("code");
  const safeCode = rawCode && SAFE_CODE_PATTERN.test(rawCode) ? rawCode : null;

  return (
    <div className="px-4 py-10 max-w-2xl mx-auto">
      <div className="card p-6 text-center">
        <h1 className="text-xl font-extrabold">결제를 완료하지 못했습니다</h1>
        <p className="mt-3 text-sm text-muted">{resolveFailureMessage(rawCode)}</p>
        {safeCode && <p className="mt-2 text-xs text-muted">오류 코드: {safeCode}</p>}
        <Link href="/mypage/orders" className="btn-primary mt-6 inline-flex h-11 items-center px-5">
          주문내역에서 다시 결제하기
        </Link>
      </div>
    </div>
  );
}

export default function PaymentFailPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <Suspense fallback={<LoadingState />}>
        <FailContent />
      </Suspense>
    </RequireAuth>
  );
}
