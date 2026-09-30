"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatZodIssues } from "@/lib/validation-messages";

// Matches passwordResetConfirmSchema (src/lib/server/passwordReset.ts)
// field-for-field.
const LABELS: Record<string, string> = {
  token: "재설정 코드",
  password: "비밀번호",
};

export default function ResetPasswordConfirmPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/account/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; details?: unknown }
          | null;
        if (body?.error === "VALIDATION_ERROR") {
          const lines = formatZodIssues(body.details, LABELS);
          setError(lines.length > 0 ? lines.join("\n") : "입력값을 확인해 주세요.");
          return;
        }
        setError(
          body?.error === "INVALID_OR_EXPIRED_TOKEN"
            ? "재설정 코드가 올바르지 않거나 만료되었습니다. 담당자에게 다시 문의해 주세요."
            : "비밀번호를 변경하지 못했습니다.",
        );
        return;
      }
      setCompleted(true);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <div className="flex justify-center px-4 py-16">
        <div className="card w-full max-w-sm p-8 text-center">
          <h1 className="text-xl font-extrabold">비밀번호가 변경되었습니다.</h1>
          <p className="text-sm text-muted leading-relaxed mt-3">
            새 비밀번호로 다시 로그인해 주세요.
          </p>
          <Link href="/login" className="btn-primary h-11 px-5 mt-6">
            로그인 화면으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="card rounded-2xl p-6 flex flex-col gap-3 shadow-[var(--shadow-lg)]">
          <h2 className="text-center font-bold mb-1">비밀번호 재설정 완료</h2>
          <p className="text-xs text-muted text-center mb-2">
            담당자에게 전달받은 재설정 코드와 새 비밀번호를 입력해 주세요.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-token" className="text-xs font-medium text-foreground/70">
                재설정 코드
              </label>
              <input
                id="reset-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="담당자에게 전달받은 코드"
                className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-password" className="text-xs font-medium text-foreground/70">
                새 비밀번호(8자 이상)
              </label>
              <input
                id="reset-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reset-password-confirm" className="text-xs font-medium text-foreground/70">
                새 비밀번호 확인
              </label>
              <input
                id="reset-password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
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
              {submitting ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>

          <div className="flex items-center justify-center gap-2 text-xs text-muted mt-2">
            <Link href="/login" className="hover:text-brand">
              로그인으로 돌아가기
            </Link>
            <span>·</span>
            <Link href="/reset-password" className="hover:text-brand">
              재설정 다시 요청
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
