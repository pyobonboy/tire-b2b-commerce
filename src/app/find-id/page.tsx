"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatZodIssues } from "@/lib/validation-messages";

// Matches findIdRequestSchema (src/lib/server/findId.ts) field-for-field.
const LABELS: Record<string, string> = {
  businessRegNumber: "사업자등록번호",
  mobilePhone: "휴대전화",
};

export default function FindIdPage() {
  const [businessRegNumber, setBusinessRegNumber] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maskedLoginId, setMaskedLoginId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setChecked(false);

    try {
      const response = await fetch("/api/account/find-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessRegNumber, mobilePhone }),
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
      const body = (await response.json()) as { maskedLoginId: string | null };
      setMaskedLoginId(body.maskedLoginId);
      setChecked(true);
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
          <h2 className="text-center font-bold mb-1">아이디 찾기</h2>
          <p className="text-xs text-muted text-center mb-2">
            가입 시 등록한 사업자등록번호와 휴대전화 번호가 모두 일치해야 확인할 수 있습니다.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="find-id-bizno" className="text-xs font-medium text-foreground/70">
                사업자등록번호
              </label>
              <input
                id="find-id-bizno"
                value={businessRegNumber}
                onChange={(e) => setBusinessRegNumber(e.target.value)}
                placeholder="하이픈 없이 숫자만 입력해도 됩니다"
                className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="find-id-phone" className="text-xs font-medium text-foreground/70">
                휴대전화
              </label>
              <input
                id="find-id-phone"
                value={mobilePhone}
                onChange={(e) => setMobilePhone(e.target.value)}
                placeholder="가입 시 등록한 휴대전화 번호"
                className="h-11 px-4 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-accent whitespace-pre-line">
                {error}
              </p>
            )}

            {checked && (
              <p className="text-sm">
                {maskedLoginId ? (
                  <span className="text-success">
                    일치하는 아이디: <strong>{maskedLoginId}</strong>
                  </span>
                ) : (
                  <span className="text-muted">
                    입력하신 정보와 일치하는 계정을 찾을 수 없습니다.
                  </span>
                )}
              </p>
            )}

            <button type="submit" disabled={submitting} className="btn-primary h-11 mt-2">
              {submitting ? "확인 중..." : "아이디 확인"}
            </button>
          </form>

          <div className="flex items-center justify-center gap-2 text-xs text-muted mt-2">
            <Link href="/login" className="hover:text-brand">
              로그인으로 돌아가기
            </Link>
            <span>·</span>
            <Link href="/reset-password" className="hover:text-brand">
              비밀번호 재설정
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
