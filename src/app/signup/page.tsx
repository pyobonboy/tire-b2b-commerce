"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatZodIssues } from "@/lib/validation-messages";

// Matches buyerSignupSchema (src/lib/server/buyer.ts) field-for-field.
const LABELS: Record<string, string> = {
  loginId: "아이디",
  password: "비밀번호",
  businessName: "상호명",
  businessRegNumber: "사업자등록번호",
  ownerName: "대표자명",
  mobilePhone: "휴대전화",
  email: "이메일",
  businessType: "사업자 유형",
  businessCategory: "업태/종목",
  postalCode: "우편번호",
  address: "주소",
  officePhone: "사무실 전화",
  contact1: "담당자 1",
  contact2: "담당자 2",
};

const OVERRIDES: Record<string, string> = {
  loginId: "영문, 숫자, 점(.), 밑줄(_), 하이픈(-)만 사용할 수 있습니다",
};

interface SignupForm {
  loginId: string;
  password: string;
  businessName: string;
  businessRegNumber: string;
  ownerName: string;
  mobilePhone: string;
  email: string;
  businessType: string;
  businessCategory: string;
  postalCode: string;
  address: string;
  officePhone: string;
  contact1: string;
  contact2: string;
}

const initialForm: SignupForm = {
  loginId: "",
  password: "",
  businessName: "",
  businessRegNumber: "",
  ownerName: "",
  mobilePhone: "",
  email: "",
  businessType: "",
  businessCategory: "",
  postalCode: "",
  address: "",
  officePhone: "",
  contact1: "",
  contact2: "",
};

export default function BuyerSignupPage() {
  const [form, setForm] = useState<SignupForm>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  function setField(field: keyof SignupForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/buyer/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; field?: string | null; message?: string; details?: unknown }
          | null;
        if (body?.error === "VALIDATION_ERROR") {
          const lines = formatZodIssues(body.details, LABELS, OVERRIDES);
          setError(lines.length > 0 ? lines.join("\n") : "입력값을 확인해 주세요.");
          return;
        }
        setError(
          body?.error === "DUPLICATE_RESOURCE"
            ? body.message ?? "이미 사용 중인 아이디입니다."
            : "가입 신청을 등록하지 못했습니다. 입력값을 확인해 주세요.",
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
        <div className="card w-full max-w-lg p-8 text-center">
          <h1 className="text-xl font-extrabold">구매자 가입 신청이 접수되었습니다.</h1>
          <p className="text-sm text-muted leading-relaxed mt-3">
            사업자 정보를 확인한 뒤 관리자가 계정을 승인합니다. 승인 완료 후 입력하신 아이디로 로그인할 수 있습니다.
          </p>
          <Link href="/login" className="btn-primary h-11 px-5 mt-6">
            로그인 화면으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="card w-full max-w-3xl p-6 md:p-8">
        <div className="mb-6">
          <Link href="/login" className="text-sm text-muted hover:text-brand">
            ← 로그인
          </Link>
          <h1 className="text-xl font-extrabold mt-3">구매자 가입 신청</h1>
          <p className="text-sm text-muted mt-1">
            사업자등록번호가 있는 타이어 가게·정비소만 신청할 수 있습니다. 관리자 승인 후 서비스를 이용할 수 있습니다.
          </p>
        </div>

        {error && <p className="text-sm text-accent mb-4 whitespace-pre-line">{error}</p>}

        <section className="mb-6">
          <h2 className="font-bold mb-3">로그인 정보</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="아이디" value={form.loginId} onChange={(value) => setField("loginId", value)} required />
            <Input label="비밀번호(8자 이상)" type="password" value={form.password} onChange={(value) => setField("password", value)} required />
          </div>
        </section>

        <section className="mb-6">
          <h2 className="font-bold mb-3">사업자 정보</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="상호명" value={form.businessName} onChange={(value) => setField("businessName", value)} required />
            <Input label="사업자등록번호" value={form.businessRegNumber} onChange={(value) => setField("businessRegNumber", value)} required />
            <Input label="대표자명" value={form.ownerName} onChange={(value) => setField("ownerName", value)} required />
            <Input label="휴대전화" type="tel" value={form.mobilePhone} onChange={(value) => setField("mobilePhone", value)} required />
            <Input label="이메일" type="email" value={form.email} onChange={(value) => setField("email", value)} />
            <Input label="사업자 유형" value={form.businessType} onChange={(value) => setField("businessType", value)} />
            <Input label="업태/종목" value={form.businessCategory} onChange={(value) => setField("businessCategory", value)} />
            <Input label="사무실 전화" type="tel" value={form.officePhone} onChange={(value) => setField("officePhone", value)} />
            <Input label="우편번호" value={form.postalCode} onChange={(value) => setField("postalCode", value)} />
            <Input label="주소" value={form.address} onChange={(value) => setField("address", value)} />
            <Input label="담당자 1" value={form.contact1} onChange={(value) => setField("contact1", value)} />
            <Input label="담당자 2" value={form.contact2} onChange={(value) => setField("contact2", value)} />
          </div>
        </section>

        <button type="submit" className="btn-primary h-11 w-full" disabled={submitting}>
          {submitting ? "신청 중…" : "구매자 가입 신청"}
        </button>
      </form>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium text-foreground/70">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="seller-input"
        required={required}
      />
    </label>
  );
}
