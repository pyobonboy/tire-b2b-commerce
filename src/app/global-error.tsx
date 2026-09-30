"use client";

import { useEffect } from "react";
import "./globals.css";

// app/error.tsx does not wrap app/layout.tsx (see the error.js docs), so
// Next.js only reaches this file when the root layout itself throws while
// rendering. Because it replaces the whole root layout when active, it must
// define its own <html>/<body> and cannot export `metadata` (error
// boundaries must be Client Components) — both confirmed in
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
// under "Global Error". It deliberately does not import Header/AppShell/
// Providers: those are exactly what may have just failed to render, and the
// docs' own guidance is to keep this file's dependencies minimal.
//
// Same rule as error.tsx: never render `error.message`, only our own
// generic Korean copy, and only a digest that has already been shape-checked.
const SAFE_DIGEST_PATTERN = /^[a-zA-Z0-9]{1,64}$/;

export default function GlobalError({
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
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex items-center justify-center bg-background text-foreground px-4">
        <div className="card p-8 text-center max-w-sm">
          <h1 className="text-xl font-extrabold">문제가 발생했습니다</h1>
          <p className="mt-3 text-sm text-muted">
            일시적인 오류로 페이지를 표시하지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          {safeDigest && <p className="mt-2 text-xs text-muted">오류 코드: {safeDigest}</p>}
          <button
            type="button"
            className="btn-primary mt-6 h-11 px-5 inline-flex items-center"
            onClick={() => reset()}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
