"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { formatDate } from "@/lib/formatDate";
import type { AdminInquiryView } from "@/lib/inquiry-types";

const STATUS_LABELS: Record<string, string> = { OPEN: "답변 대기", ANSWERED: "답변완료", CLOSED: "종료" };
// FAQ_CATEGORIES ids (order/delivery/cancel/sell/member/etc) plus "product",
// which is the fixed category the product detail page sends for 상품 문의 —
// see inquiry.ts's createInquirySchema comment.
const CATEGORY_LABELS: Record<string, string> = {
  order: "주문/결제",
  delivery: "배송관련",
  cancel: "취소/반품/교환",
  sell: "판매관련",
  member: "회원관련",
  etc: "기타",
  product: "상품문의",
};

function InquiriesContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [inquiries, setInquiries] = useState<AdminInquiryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    fetch(`/api/admin/inquiries${query}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("문의 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ inquiries: AdminInquiryView[] }>;
      })
      .then((data) => {
        if (!cancelled) {
          setInquiries(data.inquiries);
          setError(null);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  function startAnswer(inquiry: AdminInquiryView) {
    setOpenId(inquiry.id);
    setAnswerDraft(inquiry.answer ?? "");
  }

  async function submitAnswer(id: string) {
    if (!answerDraft.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/inquiries/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: answerDraft }),
      });
      if (!response.ok) {
        setError("답변 등록에 실패했습니다.");
        return;
      }
      const data = (await response.json()) as { inquiry: AdminInquiryView };
      setInquiries((current) => current.map((item) => (item.id === id ? data.inquiry : item)));
      setOpenId(null);
      setAnswerDraft("");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="px-4 py-5 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold">1:1 문의 관리</h1>
        <p className="text-sm text-muted mt-1">회원이 등록한 1:1 문의와 상품 문의에 답변합니다.</p>
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">
          총 <b className="text-foreground">{inquiries.length}</b>건
        </p>
        <Select
          value={status}
          onValueChange={setStatus}
          items={[
            { value: "", label: "전체 상태" },
            { value: "OPEN", label: "답변 대기" },
            { value: "ANSWERED", label: "답변완료" },
            { value: "CLOSED", label: "종료" },
          ]}
          className="h-10 px-3 rounded-lg border border-border text-sm bg-background"
          ariaLabel="문의 상태 필터"
        />
      </div>
      {error && <p className="text-sm text-accent mb-3">{error}</p>}
      {inquiries.length === 0 ? (
        <div className="card py-16 text-center text-sm text-muted">조건에 맞는 문의가 없습니다.</div>
      ) : (
        <div className="card divide-y divide-border">
          {inquiries.map((inquiry) => (
            <div key={inquiry.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    {inquiry.listingId && <span className="text-brand mr-1.5">[상품문의]</span>}
                    {inquiry.title}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {inquiry.user.businessName} ({inquiry.user.loginId}) · {CATEGORY_LABELS[inquiry.category] ?? inquiry.category} ·{" "}
                    {formatDate(inquiry.createdAt)}
                  </p>
                  {inquiry.listingLabel && <p className="text-xs text-muted mt-0.5">관련 상품: {inquiry.listingLabel}</p>}
                </div>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    inquiry.status === "ANSWERED" ? "text-success" : "text-accent"
                  }`}
                >
                  {STATUS_LABELS[inquiry.status] ?? inquiry.status}
                </span>
              </div>
              <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{inquiry.content}</p>

              {inquiry.answer && openId !== inquiry.id && (
                <div className="mt-3 pl-3 border-l-2 border-brand/30 text-sm">
                  <p className="text-brand font-semibold text-xs mb-1">답변</p>
                  <p className="whitespace-pre-wrap">{inquiry.answer}</p>
                </div>
              )}

              {openId === inquiry.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    value={answerDraft}
                    onChange={(event) => setAnswerDraft(event.target.value)}
                    rows={4}
                    placeholder="답변 내용을 입력해주세요."
                    className="px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setOpenId(null)} className="btn-outline h-9 px-3 text-xs">
                      취소
                    </button>
                    <button
                      onClick={() => void submitAnswer(inquiry.id)}
                      disabled={submitting}
                      className="btn-primary h-9 px-3 text-xs disabled:opacity-60"
                    >
                      {inquiry.answer ? "답변 수정" : "답변 등록"}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => startAnswer(inquiry)} className="btn-outline h-8 px-2.5 text-xs mt-3">
                  {inquiry.answer ? "답변 수정" : "답변하기"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminInquiriesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <InquiriesContent />
    </Suspense>
  );
}
