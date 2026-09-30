"use client";

import { useEffect, useState } from "react";
import RequireAuth from "@/components/RequireAuth";

// Deliberately not under /admin — that route tree is owned by another task
// in this wave. This is a small, self-contained ADMIN-only screen for the
// account-recovery stopgap described in src/lib/server/passwordReset.ts:
// there is no email/SMS provider, so a human operator has to relay the
// reset code by phone after verifying the caller out-of-band. Minting here
// is the ONLY way to see a reset code once outside development — see the
// warning on mintPasswordResetTokenForAdmin.

interface OutstandingRequest {
  id: string;
  loginId: string;
  businessName: string;
  mobilePhone: string;
  requestedAt: string;
  expiresAt: string;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR");
}

/** Pure fetch, no component state — safe to call from both the initial-load
 * effect and the post-mint refresh without tripping the "no setState inside
 * an effect body" lint rule (see the useEffect below, which mirrors the
 * loadProfile pattern in mypage/settings/page.tsx). */
async function fetchOutstandingRequests(): Promise<OutstandingRequest[]> {
  const response = await fetch("/api/account/password-reset/admin", { cache: "no-store" });
  if (!response.ok) throw new Error("목록을 불러오지 못했습니다.");
  const body = (await response.json()) as { requests: OutstandingRequest[] };
  return body.requests;
}

function AdminContent() {
  const [requests, setRequests] = useState<OutstandingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mintingFor, setMintingFor] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<{ loginId: string; token: string; expiresAt: string } | null>(null);
  const [manualLoginId, setManualLoginId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const nextRequests = await fetchOutstandingRequests();
        if (active) setRequests(nextRequests);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "목록을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  async function mintToken(loginId: string) {
    if (!loginId) return;
    setMintingFor(loginId);
    setError("");
    setMintResult(null);
    try {
      const response = await fetch("/api/account/password-reset/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          body?.error === "ACCOUNT_NOT_FOUND" ? "해당 아이디의 계정을 찾을 수 없습니다." : "코드를 발급하지 못했습니다.",
        );
      }
      const body = (await response.json()) as { loginId: string; token: string; expiresAt: string };
      setMintResult(body);
      try {
        setRequests(await fetchOutstandingRequests());
      } catch {
        // Refresh is best-effort — the mint itself already succeeded and is
        // shown above regardless of whether the list reload works.
      }
    } catch (mintError) {
      setError(mintError instanceof Error ? mintError.message : "코드를 발급하지 못했습니다.");
    } finally {
      setMintingFor(null);
    }
  }

  return (
    <div className="px-4 py-5 max-w-3xl mx-auto">
      <h1 className="text-xl font-extrabold mb-2">비밀번호 재설정 대기 목록</h1>
      <p className="text-sm text-muted mb-5">
        전화 등 다른 수단으로 신청자 본인을 확인한 뒤에만 재설정 코드를 발급하세요. 발급된 코드는
        이 화면에만 표시되며 다시 조회할 수 없으니, 확인 즉시 전화로 안내해 주세요.
      </p>

      {error && <p className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {mintResult && (
        <div className="card p-4 mb-5 border-success/30">
          <p className="text-sm font-bold mb-1">
            {mintResult.loginId} 재설정 코드가 발급되었습니다.
          </p>
          <p className="text-lg font-mono tracking-wider">{mintResult.token}</p>
          <p className="text-xs text-muted mt-1">만료: {formatDateTime(mintResult.expiresAt)}</p>
        </div>
      )}

      <section className="card p-5 mb-5">
        <h2 className="font-bold mb-3">아이디로 직접 발급</h2>
        <div className="flex gap-2">
          <input
            value={manualLoginId}
            onChange={(e) => setManualLoginId(e.target.value)}
            placeholder="로그인 아이디"
            className="h-11 px-4 rounded-lg border border-border flex-1 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void mintToken(manualLoginId.trim())}
            disabled={!manualLoginId.trim() || mintingFor !== null}
            className="btn-primary h-11 px-4"
          >
            발급
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-bold mb-3">대기 중인 요청</h2>
        {loading ? (
          <p className="text-sm text-muted">불러오는 중...</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted">대기 중인 요청이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium">
                    {req.loginId} <span className="text-muted font-normal">· {req.businessName}</span>
                  </p>
                  <p className="text-xs text-muted">
                    연락처 {req.mobilePhone} · 요청 {formatDateTime(req.requestedAt)} · 만료{" "}
                    {formatDateTime(req.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void mintToken(req.loginId)}
                  disabled={mintingFor !== null}
                  className="btn-outline h-9 px-3 text-sm"
                >
                  {mintingFor === req.loginId ? "발급 중..." : "코드 발급"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PasswordResetAdminPage() {
  return (
    <RequireAuth allow={["ADMIN"]}>
      <AdminContent />
    </RequireAuth>
  );
}
