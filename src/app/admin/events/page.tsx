"use client";

import Link from "next/link";
import { EVENTS, NOTICES } from "@/lib/mockData";

export default function AdminEventsPage() {
  return (
    <div className="px-4 py-5 max-w-6xl">
      <div className="mb-5"><h1 className="text-xl font-extrabold">공지·이벤트</h1><p className="text-sm text-muted mt-1">현재 공개 화면에 사용 중인 공지와 이벤트 콘텐츠를 확인합니다.</p></div>
      <div className="rounded-lg border border-yellow-300/60 bg-yellow-50 text-yellow-800 p-3 text-sm mb-5">
        현재 Prisma 설계에는 공지·이벤트 저장 모델과 관리 API가 정의되어 있지 않아 이 화면은 읽기 전용입니다. 데이터는 기존 mock 콘텐츠를 표시하며, 임의의 CMS 스키마는 추가하지 않았습니다.
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-5"><h2 className="font-bold mb-4">이벤트 ({EVENTS.length})</h2><div className="flex flex-col gap-3">{EVENTS.map((event) => <div key={event.id} className="rounded-lg border border-border p-4"><div className="flex items-center justify-between gap-2"><p className="font-semibold">{event.title}</p><span className={`text-xs ${event.status === "ongoing" ? "text-brand" : "text-muted"}`}>{event.status === "ongoing" ? "진행중" : "종료"}</span></div><p className="text-xs text-muted mt-1">{event.period}</p><p className="text-sm text-muted mt-2 leading-relaxed">{event.description}</p></div>)}</div></section>
        <section className="card p-5"><h2 className="font-bold mb-4">공지 ({NOTICES.length})</h2><div className="divide-y divide-border">{NOTICES.map((notice) => <div key={notice.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"><p className="text-sm font-medium">{notice.title}</p><span className="text-xs text-muted shrink-0">{notice.date}</span></div>)}</div><Link href="/events" className="btn-outline h-10 px-4 text-sm mt-5">공개 이벤트 화면 보기</Link></section>
      </div>
    </div>
  );
}
