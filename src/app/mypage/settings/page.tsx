"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useDialogs } from "@/components/ui/DialogProvider";
import Select from "@/components/ui/Select";
import { useAuth } from "@/lib/auth";
import type { AccountProfile } from "@/lib/account-types";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground/70">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "h-11 px-3 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand";
const disabledInputClass = `${inputClass} bg-surface-2 text-muted`;
const BANKS = ["국민은행", "신한은행", "우리은행", "하나은행", "농협은행", "카카오뱅크"];

type SettingsForm = {
  email: string;
  notifyOptIn: boolean;
  postalCode: string;
  address: string;
  officePhone: string;
  mobilePhone: string;
  contact1: string;
  contact2: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
};

const emptyForm: SettingsForm = {
  email: "",
  notifyOptIn: true,
  postalCode: "",
  address: "",
  officePhone: "",
  mobilePhone: "",
  contact1: "",
  contact2: "",
  bankName: "",
  bankAccountNumber: "",
  bankAccountHolder: "",
};

function formFromProfile(profile: AccountProfile): SettingsForm {
  return {
    email: profile.email ?? "",
    notifyOptIn: profile.notifyOptIn,
    postalCode: profile.postalCode ?? "",
    address: profile.address ?? "",
    officePhone: profile.officePhone ?? "",
    mobilePhone: profile.mobilePhone,
    contact1: profile.contact1 ?? "",
    contact2: profile.contact2 ?? "",
    bankName: profile.bankName ?? "",
    bankAccountNumber: profile.bankAccountNumber ?? "",
    bankAccountHolder: profile.bankAccountHolder ?? "",
  };
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error === "ACTIVE_ORDERS_EXIST") return "진행 중인 주문이 있어 탈퇴할 수 없습니다.";
    if (body.error === "ACCOUNT_ALREADY_WITHDRAWN") return "이미 탈퇴 처리된 계정입니다.";
    if (body.error === "VALIDATION_ERROR") return "입력한 정보를 확인해 주세요.";
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

function SettingsContent() {
  const { confirm: confirmDialog } = useDialogs();
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const response = await fetch("/api/account/settings", { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response, "회원 정보를 불러오지 못했습니다."));
        const body = (await response.json()) as { profile: AccountProfile };
        if (active) {
          setProfile(body.profile);
          setForm(formFromProfile(body.profile));
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "회원 정보를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      active = false;
    };
  }, []);

  function updateField<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setMessage("");
    setError("");
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/account/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await readError(response, "회원 정보 저장에 실패했습니다."));
      const body = (await response.json()) as { profile: AccountProfile };
      setProfile(body.profile);
      setForm(formFromProfile(body.profile));
      setSaved(true);
      setMessage("회원 정보가 저장되었습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "회원 정보 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function verifyBankAccount() {
    if (!form.bankName || !form.bankAccountNumber || !form.bankAccountHolder) {
      setError("은행, 계좌번호, 예금주를 모두 입력해 주세요.");
      return;
    }

    setVerifying(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account/bank-account/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName: form.bankName,
          bankAccountNumber: form.bankAccountNumber,
          bankAccountHolder: form.bankAccountHolder,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "계좌 정보 저장에 실패했습니다."));
      const body = (await response.json()) as { profile: AccountProfile; verified: boolean };
      setProfile(body.profile);
      setForm(formFromProfile(body.profile));
      // Reflect what the server actually reported rather than assuming —
      // today's provider always answers unverified (see bankVerification.ts),
      // but this stays correct once a real 실명조회 provider is wired in.
      setMessage(
        body.verified
          ? "계좌 정보가 저장되었고 예금주 실명조회가 확인되었습니다."
          : "계좌 정보가 저장되었습니다. 실명조회는 관리자 확인 대기 상태입니다.",
      );
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "계좌 정보 저장에 실패했습니다.");
    } finally {
      setVerifying(false);
    }
  }

  async function withdraw() {
    if (
      !(await confirmDialog({
        title: "정말 탈퇴하시겠습니까?",
        description: "탈퇴 후에는 계정을 사용할 수 없습니다.",
        destructive: true,
      }))
    )
      return;

    setWithdrawing(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account/withdraw", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "회원 탈퇴에 실패했습니다."));
      router.replace("/login");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "회원 탈퇴에 실패했습니다.");
      setWithdrawing(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-8 text-sm text-muted">회원 정보를 불러오는 중입니다...</div>;
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-5">회원 정보 수정</h1>

      {error && <p className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      {message && <p className="mb-4 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">{message}</p>}

      <form onSubmit={saveSettings} className="flex flex-col gap-6">
        <section className="card p-5">
          <h2 className="font-bold mb-4">회원 정보</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="로그인 ID" htmlFor="s-id">
              <input id="s-id" disabled value={profile?.loginId ?? user?.id ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="업체명" htmlFor="s-business">
              <input id="s-business" disabled value={profile?.businessName ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="이메일" htmlFor="s-email">
              <input
                id="s-email"
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="휴대전화" htmlFor="s-mobile-phone">
              <input
                id="s-mobile-phone"
                value={form.mobilePhone}
                onChange={(event) => updateField("mobilePhone", event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted mt-4">
            <input
              type="checkbox"
              checked={form.notifyOptIn}
              onChange={(event) => updateField("notifyOptIn", event.target.checked)}
              className="w-4 h-4"
            />
            업체 알림(승인/지연/배송 알림 문자) 수신에 동의합니다.
          </label>
        </section>

        <section className="card p-5">
          <h2 className="font-bold mb-4">주문 / 배송 정보</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="담당자" htmlFor="s-owner">
              <input id="s-owner" disabled value={profile?.ownerName ?? user?.ownerName ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="우편번호" htmlFor="s-postal-code">
              <input
                id="s-postal-code"
                value={form.postalCode}
                onChange={(event) => updateField("postalCode", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="주소" htmlFor="s-address">
              <input
                id="s-address"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="사무실 전화" htmlFor="s-office-phone">
              <input
                id="s-office-phone"
                value={form.officePhone}
                onChange={(event) => updateField("officePhone", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="담당자 연락처 1" htmlFor="s-contact1">
              <input
                id="s-contact1"
                value={form.contact1}
                onChange={(event) => updateField("contact1", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="담당자 연락처 2" htmlFor="s-contact2">
              <input
                id="s-contact2"
                value={form.contact2}
                onChange={(event) => updateField("contact2", event.target.value)}
                placeholder="선택 입력"
                className={inputClass}
              />
            </Field>
          </div>
          <p className="text-xs text-muted mt-3">담당자 연락처로 주문 관련 알림 문자가 발송됩니다.</p>
        </section>

        <section className="card p-5">
          <h2 className="font-bold mb-4">사업자 정보</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="사업자번호" htmlFor="s-bizno">
              <input id="s-bizno" disabled value={profile?.businessRegNumber ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="업체명" htmlFor="s-bizname">
              <input id="s-bizname" disabled value={profile?.businessName ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="대표자명" htmlFor="s-ceo">
              <input id="s-ceo" disabled value={profile?.ownerName ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="사업자 유형" htmlFor="s-business-type">
              <input id="s-business-type" disabled value={profile?.businessType ?? ""} className={disabledInputClass} />
            </Field>
            <Field label="업종" htmlFor="s-business-category">
              <input id="s-business-category" disabled value={profile?.businessCategory ?? ""} className={disabledInputClass} />
            </Field>
          </div>
          <p className="text-xs text-muted mt-3">사업자 정보 변경은 관리자 검토 후 반영됩니다.</p>
        </section>

        <section className="card p-5">
          <h2 className="font-bold mb-4">환불 / 정산 계좌</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="은행" htmlFor="s-bank">
              <Select
                value={form.bankName}
                onValueChange={(value) => updateField("bankName", value)}
                items={BANKS.map((bank) => ({ value: bank, label: bank }))}
                placeholder="은행을 선택해 주세요"
                className={inputClass}
                ariaLabel="은행"
                name="s-bank"
                id="s-bank"
              />
            </Field>
            <Field label="계좌번호" htmlFor="s-account">
              <input
                id="s-account"
                value={form.bankAccountNumber}
                onChange={(event) => updateField("bankAccountNumber", event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="예금주" htmlFor="s-account-holder">
              <input
                id="s-account-holder"
                value={form.bankAccountHolder}
                onChange={(event) => updateField("bankAccountHolder", event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void verifyBankAccount()} disabled={verifying} className="btn-outline h-10 px-4">
              {verifying ? "저장 중..." : "계좌 정보 저장"}
            </button>
            <span className="text-xs text-warning">
              {profile?.bankAccountVerifiedAt ? "인증 완료" : "미인증 · 관리자 확인 대기"}
            </span>
          </div>
          <p className="text-xs text-muted mt-3">1차 운영에서는 외부 실명조회와 실제 정산 이체를 진행하지 않습니다.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary h-11 px-6">
            {saving ? "저장 중..." : "저장하기"}
          </button>
          {saved && <span className="text-sm text-success font-medium">저장되었습니다.</span>}
        </div>
      </form>

      <section className="card mt-6 border-danger/30 p-5">
        <h2 className="font-bold text-danger mb-2">회원 탈퇴</h2>
        <p className="text-sm text-muted mb-4">배송완료 전 진행 중인 주문이나 미정산 건이 있으면 탈퇴할 수 없습니다.</p>
        <button type="button" onClick={() => void withdraw()} disabled={withdrawing} className="btn-outline h-10 px-4 border-danger/40 text-danger">
          {withdrawing ? "처리 중..." : "회원 탈퇴"}
        </button>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}
