"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

// This is the App Router error boundary for everything under the root
// layout (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
// It wraps every nested layout/page but NOT app/layout.tsx itself — a throw
// while rendering the root layout falls through to global-error.tsx instead.
//
// Next.js already replaces the `message` of errors thrown in Server
// Components with a generic placeholder in production, but errors thrown in
// Client Components still carry their original message here. This app
// handles payments and business-registration PII, so we cannot rely on that
// distinction — we never render `error.message` (or anything derived from
// it) under any circumstance. The real error is only ever logged via
// console.error, which lands in server logs, not the response.
//
// `error.digest` is safe to display (Next.js generates it purely to
// correlate this occurrence with server-side logs), but we still constrain
// its shape before rendering — the same defensive pattern used for the Toss
// failure `code` in src/app/orders/pay/fail/page.tsx — so nothing upstream
// could ever repurpose this field to smuggle free text onto the page.
const SAFE_DIGEST_PATTERN = /^[a-zA-Z0-9]{1,64}$/;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const safeDigest = error.digest && SAFE_DIGEST_PATTERN.test(error.digest) ? error.digest : null;

  return (
    <div className="px-4 py-16 max-w-2xl mx-auto">
      <div className="card p-8 text-center">
        <AlertTriangle className="mx-auto text-accent" size={40} />
        <h1 className="mt-4 text-xl font-extrabold">문제가 발생했습니다</h1>
        <p className="mt-3 text-sm text-muted">
          일시적인 오류로 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        {safeDigest && <p className="mt-2 text-xs text-muted">오류 코드: {safeDigest}</p>}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-primary h-11 px-5 inline-flex items-center gap-2"
            onClick={() => reset()}
          >
            <RotateCcw size={16} />
            다시 시도
          </button>
          <Link href="/" className="btn-outline h-11 px-5 inline-flex items-center">
            홈으로 가기
          </Link>
        </div>
      </div>
    </div>
  );
}
