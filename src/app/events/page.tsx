"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import { EVENTS, EVENT_BANNER_IMAGES } from "@/lib/mockData";

type Tab = "all" | "ongoing" | "ended";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "전체 이벤트" },
  { key: "ongoing", label: "진행중인 이벤트" },
  { key: "ended", label: "종료된 이벤트" },
];

function EventsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = (searchParams.get("tab") as Tab) ?? "ongoing";

  const filtered = EVENTS.filter((e) => tab === "all" || e.status === tab);

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-1.5 mb-1">
        <Bell size={18} className="text-brand" />
        <h1 className="text-xl font-extrabold">이벤트</h1>
      </div>
      <p className="text-sm text-muted mb-5">타이어존의 다양한 이벤트를 확인해보세요!</p>

      <div className="flex gap-6 border-b border-border mb-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => router.push(`/events?tab=${t.key}`)}
            className={`pb-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-brand text-brand"
                : "border-transparent text-muted hover:text-foreground hover:border-border"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center text-muted py-16 text-sm animate-[fade-slide-up_400ms_ease-out_both]">
          <Bell size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          해당하는 이벤트가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
          {filtered.map((e, i) => {
            const bannerImage = EVENT_BANNER_IMAGES[e.id];
            return (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="block group animate-[fade-slide-up_400ms_ease-out_both]"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div
                  className="relative aspect-[16/9] rounded-xl mb-2 border border-border overflow-hidden transition-transform group-hover:-translate-y-1 group-hover:shadow-lg"
                  style={bannerImage ? undefined : { background: e.bannerGradient }}
                >
                  {bannerImage && (
                    <Image
                      src={bannerImage}
                      alt={e.title}
                      fill
                      className="object-cover"
                      sizes="(min-width: 1024px) 280px, 45vw"
                    />
                  )}
                </div>
                <p className="text-sm font-semibold line-clamp-2 group-hover:text-brand">
                  {e.title}
                </p>
                <p className="text-xs text-muted mt-0.5">{e.period}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <EventsContent />
    </Suspense>
  );
}
