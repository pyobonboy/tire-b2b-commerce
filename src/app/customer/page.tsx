"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown,
  CreditCard,
  HelpCircle,
  Megaphone,
  Rss,
  Send,
  Settings,
  Store,
  Truck,
  Undo2,
  User,
} from "lucide-react";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/ui/Select";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import type { InquiryView } from "@/lib/inquiry-types";
import { CUSTOMER_LINKS } from "@/lib/nav";
import { FAQ_CATEGORIES, FAQ_ITEMS, NOTICES, UPDATE_LOGS } from "@/lib/mockData";

const FAQ_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  order: CreditCard,
  delivery: Truck,
  cancel: Undo2,
  sell: Store,
  member: User,
  etc: Settings,
};

function NoticeTable() {
  return (
    <>
      <h1 className="text-xl font-extrabold mb-1">공지사항</h1>
      <p className="text-sm text-muted mb-5">총 {NOTICES.length}개의 게시물</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm border-collapse">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-3 px-4 font-medium w-20">글번호</th>
              <th className="py-3 px-4 font-medium">제목</th>
              <th className="py-3 px-4 font-medium w-32">작성일자</th>
            </tr>
          </thead>
          <tbody>
            {NOTICES.map((n, i) => (
              <tr key={n.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="py-3 px-4 text-muted">{NOTICES.length - i}</td>
                <td className="py-3 px-4 font-medium">{n.title}</td>
                <td className="py-3 px-4 text-muted whitespace-nowrap">{n.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FaqBoard() {
  const [category, setCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = category ? FAQ_ITEMS.filter((f) => f.category === category) : FAQ_ITEMS;

  return (
    <>
      <h1 className="text-xl font-extrabold mb-1">자주묻는 질문</h1>
      <p className="text-sm text-muted mb-5">카테고리를 선택해 자주 묻는 질문을 확인하세요.</p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
        {FAQ_CATEGORIES.map((c) => {
          const Icon = FAQ_ICONS[c.id] ?? HelpCircle;
          const active = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(active ? null : c.id)}
              className={`card p-4 flex flex-col items-center gap-2 text-center card-hover ${
                active ? "border-brand" : ""
              }`}
            >
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  active ? "bg-brand text-white" : "bg-brand/10 text-brand"
                }`}
              >
                <Icon size={20} />
              </div>
              <span className="text-xs font-medium">{c.label}</span>
            </button>
          );
        })}
      </div>

      <div className="card divide-y divide-border">
        {visible.map((f) => {
          const open = openId === f.id;
          return (
            <div key={f.id}>
              <button
                onClick={() => setOpenId(open ? null : f.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-surface-2"
              >
                <span className="font-medium flex items-center gap-2">
                  <span className="text-brand font-bold">Q.</span> {f.q}
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open && (
                <p className="px-4 pb-4 text-sm text-muted leading-relaxed">
                  <span className="text-brand font-bold">A.</span> {f.a}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// FAQ_CATEGORIES 라벨을 그대로 재사용한다 — Inquiry.category 는 DB enum이
// 아니라 자유 문자열이라서(스키마 참고) 이 목록과의 결합은 UI 쪽 관례일
// 뿐이지만, 문의 유형 선택지를 두 군데서 따로 관리하지 않기 위함이다.
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  FAQ_CATEGORIES.map((c) => [c.id, c.label]),
);

const INQUIRY_STATUS_LABEL: Record<string, string> = {
  OPEN: "답변대기",
  ANSWERED: "답변완료",
  CLOSED: "종료",
};

function QnaBoard() {
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [inquiries, setInquiries] = useState<InquiryView[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inquiries", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("문의 내역을 불러오지 못했습니다.");
        return response.json() as Promise<{ inquiries: InquiryView[] }>;
      })
      .then((data) => {
        if (!cancelled) setInquiries(data.inquiries);
      })
      .catch((reason: Error) => {
        if (!cancelled) setListError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 문의 유형은 서버(createInquirySchema)에서도 필수다. 네이티브 <select
    // required> 를 Radix Select 로 바꾸면서 브라우저의 기본 검증이 사라졌으므로,
    // 여기서 직접 막지 않으면 빈 값이 그대로 전송돼 400 이 나고 사용자에게는
    // "문의 등록에 실패했습니다" 라는 엉뚱한 메시지만 보인다.
    if (!category) {
      setSubmitError("문의 유형을 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, content }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setSubmitError(
          body?.error === "TOO_MANY_REQUESTS"
            ? "문의를 너무 많이 등록했습니다. 잠시 후 다시 시도해 주세요."
            : "문의 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      const data = (await response.json()) as { inquiry: InquiryView };
      setInquiries((current) => [data.inquiry, ...(current ?? [])]);
      setSubmitted(true);
      setCategory("");
      setTitle("");
      setContent("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-extrabold mb-1">1:1 문의</h1>
      <p className="text-sm text-muted mb-5">궁금하신 내용을 남겨주시면 순차적으로 답변드립니다.</p>

      <form onSubmit={(event) => void handleSubmit(event)} className="card p-5 flex flex-col gap-3">
        <Select
          value={category}
          onValueChange={setCategory}
          items={FAQ_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
          placeholder="문의 유형 선택"
          className="h-11 px-3 rounded-lg border border-border text-sm sm:w-56 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
          ariaLabel="문의 유형 선택"
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          placeholder="제목"
          className="h-11 px-3 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
        />
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          required
          rows={6}
          placeholder="문의 내용을 입력해주세요."
          className="px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
        />
        <button type="submit" disabled={submitting} className="btn-primary h-11 self-end px-6 gap-1.5 disabled:opacity-60">
          <Send size={15} /> {submitting ? "등록 중..." : "문의 등록"}
        </button>
        {submitError && <p className="text-sm text-accent font-medium">{submitError}</p>}
        {submitted && !submitError && (
          <p className="text-sm text-success font-medium">문의가 등록되었습니다. 순차적으로 답변드리겠습니다.</p>
        )}
      </form>

      <h2 className="font-bold mt-8 mb-3">나의 문의 내역</h2>
      {listError ? (
        <p className="text-sm text-accent">{listError}</p>
      ) : inquiries === null ? (
        <LoadingState />
      ) : inquiries.length === 0 ? (
        <div className="card py-14 text-center text-muted text-sm">등록된 문의 내역이 없습니다.</div>
      ) : (
        <div className="card divide-y divide-border">
          {inquiries.map((inquiry) => (
            <div key={inquiry.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-sm">
                  {inquiry.listingId && <span className="text-brand mr-1.5">[상품문의]</span>}
                  {inquiry.title}
                </p>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    inquiry.status === "ANSWERED" ? "text-success" : "text-muted"
                  }`}
                >
                  {INQUIRY_STATUS_LABEL[inquiry.status] ?? inquiry.status}
                </span>
              </div>
              <p className="text-xs text-muted mt-1">
                {CATEGORY_LABELS[inquiry.category] ?? inquiry.category} · {formatDate(inquiry.createdAt)}
              </p>
              <p className="text-sm text-muted mt-2 whitespace-pre-wrap">{inquiry.content}</p>
              {inquiry.answer && (
                <div className="mt-3 pl-3 border-l-2 border-brand/30 text-sm">
                  <p className="text-brand font-semibold text-xs mb-1">답변</p>
                  <p className="text-foreground/90 whitespace-pre-wrap">{inquiry.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function UpdateLogBoard() {
  return (
    <>
      <h1 className="text-xl font-extrabold mb-1">업데이트 내역</h1>
      <p className="text-sm text-muted mb-5">타이어존의 최근 기능 업데이트 소식입니다.</p>
      <div className="card divide-y divide-border">
        {UPDATE_LOGS.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="flex items-center gap-2">
              <Rss size={13} className="text-brand shrink-0" />
              {u.title}
            </span>
            <span className="text-muted text-xs shrink-0 ml-3">{u.date}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function CustomerContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "notice";

  return (
    <div className="px-4 py-5 max-w-[1680px] mx-auto flex gap-6">
      <aside className="hidden lg:flex w-48 shrink-0 flex-col gap-1 py-1">
        <p className="px-3 pb-2 text-xs font-semibold text-muted flex items-center gap-1.5">
          <Megaphone size={13} /> 고객센터
        </p>
        {CUSTOMER_LINKS.map((c) => {
          const active = c.href.includes(`tab=${tab}`);
          return (
            <Link
              key={c.href}
              href={c.href}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium ${
                active ? "bg-brand/10 text-brand" : "text-foreground/80 hover:bg-surface-2"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
      </aside>

      <div className="flex-1 min-w-0">
        <div className="flex lg:hidden gap-2 overflow-x-auto pb-3 mb-2 -mx-4 px-4">
          {CUSTOMER_LINKS.map((c) => {
            const active = c.href.includes(`tab=${tab}`);
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  active ? "bg-brand text-white border-brand" : "border-border text-foreground/70"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>

        {tab === "faq" ? (
          <FaqBoard />
        ) : tab === "qna" ? (
          user ? (
            <QnaBoard />
          ) : (
            <div className="card px-5 py-16 text-center">
              <h1 className="text-xl font-extrabold">1:1 문의는 회원 전용입니다</h1>
              <p className="mt-2 text-sm text-muted">로그인 후 문의 등록과 답변 내역을 확인할 수 있습니다.</p>
              <Link href="/login?redirect=/customer?tab=qna" className="btn-primary mt-5 h-11 px-6 text-sm">
                로그인
              </Link>
            </div>
          )
        ) : tab === "update" ? (
          <UpdateLogBoard />
        ) : (
          <NoticeTable />
        )}
      </div>
    </div>
  );
}

export default function CustomerPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CustomerContent />
    </Suspense>
  );
}
