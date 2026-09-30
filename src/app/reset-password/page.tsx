"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatZodIssues } from "@/lib/validation-messages";

// Matches passwordResetRequestSchema (src/lib/server/passwordReset.ts)
// field-for-field.
const LABELS: Record<string, string> = {
  loginId: "아이디",
  businessRegNumber: "사업자등록번호",
};

export default function ResetPasswordRequestPage() {
  const [loginId, setLoginId] = useState("");
  const [businessRegNumber, setBusinessRegNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/account/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, businessRegNumber }),
      });
      if (response.status === 429) {
        setError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; details?: unknown }
          | null;
        if (body?.error === "VALIDATION_ERROR") {
          const lines = formatZodIssues(body.details, LABELS);
          setError(lines.length > 0 ? lines.join("\n") : "입력값을 확인해 주세요.");
          return;
        }
        setError("입력값을 확인해 주세요.");
        return;
      }
      // The response is intentionally the same whether or not the account
      // actually existed / matched — see /api/account/password-reset/request.
      setSubmitted(true);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="card rounded-2xl p-6 flex flex-col gap-3 shadow-[var(--shadow-lg)]">
          <h2 className="text-center font-bold mb-1">비밀번호 재설정</h2>
          <p className="text-xs text-muted text-center mb-2">
            현재 이메일·SMS 자동 발송이 지원되지 않아, 요청 확인 후 담당자가 등록된 연락처로
            직접 연락드립니다. 담당자로부터 받은 재설정 코드는 아래{" "}
            <Link href="/reset-password/confirm" className="text-brand hover:underline">
              비밀번호 재설정 완료
            </Link>{" "}
            페이지에서 입력해 주세요.
          </p>

          {submitted ? (
            <p className="text-sm text-success text-center py-4">
              요청이 접수되었습니다. 입력하신 정보가 확인되면 담당자가 연락드립니다.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-login-id" className="text-xs font-medium text-foreground/70">
                  아이디
                </label>
                <input
                  id="reset-login-id"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-bizno" className="text-xs font-medium text-foreground/70">
                  사업자등록번호
                </label>
                <input
                  id="reset-bizno"
                  value={businessRegNumber}
                  onChange={(e) => setBusinessRegNumber(e.target.value)}
                  placeholder="본인 확인을 위해 입력해 주세요"
                  className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  required
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-accent whitespace-pre-line">
                  {error}
                </p>
              )}

              <button type="submit" disabled={submitting} className="btn-primary h-11 mt-2">
                {submitting ? "요청 중..." : "재설정 요청"}
              </button>
            </form>
          )}

          <div className="flex items-center justify-center gap-2 text-xs text-muted mt-2">
            <Link href="/login" className="hover:text-brand">
              로그인으로 돌아가기
            </Link>
            <span>·</span>
            <Link href="/find-id" className="hover:text-brand">
              아이디 찾기
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
