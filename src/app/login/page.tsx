"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";

function defaultPathForRole(role?: "BUYER" | "SELLER" | "ADMIN") {
  return role === "SELLER" ? "/seller" : role === "ADMIN" ? "/admin" : "/main";
}

function resolveRedirect(redirect: string | null, role?: "BUYER" | "SELLER" | "ADMIN") {
  if (!redirect || !redirect.startsWith("/")) return defaultPathForRole(role);
  if (redirect.startsWith("/admin") && role !== "ADMIN") return defaultPathForRole(role);
  if (redirect.startsWith("/seller") && role !== "SELLER") return defaultPathForRole(role);
  return redirect;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    router.replace(resolveRedirect(searchParams.get("redirect"), user.role));
  }, [user, router, searchParams]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(id, password);
    setSubmitting(false);
    if (result.ok) {
      router.push(resolveRedirect(searchParams.get("redirect"), result.role));
    } else {
      setError(result.message ?? "로그인에 실패했습니다.");
    }
  }

  return (
    <div className="flex justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8 animate-[fade-slide-up_400ms_ease-out_both]">
          <Image src="/logo.svg" alt="타이어존" width={220} height={64} className="h-16 w-auto mb-2" priority />
          <p className="text-sm text-muted">사업자전용 타이어거래소</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="card rounded-2xl p-6 flex flex-col gap-3 shadow-[var(--shadow-lg)] animate-[fade-slide-up_450ms_ease-out_both]"
        >
          <h2 className="text-center font-bold mb-1">회원 로그인</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-id" className="text-xs font-medium text-foreground/70">
              아이디
            </label>
            <input
              id="login-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="아이디 입력"
              autoComplete="username"
              aria-invalid={!!error}
              className={`h-11 px-4 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand ${
                error ? "border-accent" : "border-border"
              }`}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-xs font-medium text-foreground/70">
              비밀번호
            </label>
            <input
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="비밀번호 입력"
              autoComplete="current-password"
              aria-invalid={!!error}
              className={`h-11 px-4 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand ${
                error ? "border-accent" : "border-border"
              }`}
              required
            />
          </div>

          {error && (
            <p
              key={error}
              role="alert"
              className="text-sm text-accent animate-[shake_350ms_ease-out]"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={submitting} className="btn-primary h-11 mt-2">
            {submitting ? "로그인 중..." : "로그인"}
          </button>

          <div className="flex items-center justify-center gap-2 text-xs text-muted mt-1">
            <Link href="/find-id" className="hover:text-brand">
              아이디 찾기
            </Link>
            <span>·</span>
            <Link href="/reset-password" className="hover:text-brand">
              비밀번호 재설정
            </Link>
            <span>·</span>
            <Link href="/signup" className="hover:text-brand">
              회원가입
            </Link>
          </div>

          <Link href="/seller/signup" className="text-center text-sm text-brand hover:underline">
            판매자 가입 신청
          </Link>

        </form>
      </div>
    </div>
  );
}
