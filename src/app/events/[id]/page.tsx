"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { EVENTS, EVENT_BANNER_IMAGES } from "@/lib/mockData";

function EventDetailContent() {
  const params = useParams<{ id: string }>();
  const event = EVENTS.find((e) => e.id === params.id);
  const bannerImage = event && EVENT_BANNER_IMAGES[event.id];

  if (!event) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted mb-4">존재하지 않는 이벤트입니다.</p>
        <Link href="/events" className="text-brand font-semibold">
          이벤트 목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      <Link href="/events" className="text-sm text-muted mb-4 inline-flex items-center gap-0.5">
        <ChevronLeft size={16} /> 이벤트 목록
      </Link>
      <div
        className="relative h-32 md:h-44 lg:h-56 rounded-2xl mb-5 flex items-end p-5 overflow-hidden"
        style={bannerImage ? undefined : { background: event.bannerGradient }}
      >
        {bannerImage && (
          <Image src={bannerImage} alt={event.title} fill priority className="object-cover" sizes="100vw" />
        )}
        <span
          className={`text-xs font-bold px-2.5 py-1.5 rounded-full ${
            event.status === "ongoing"
              ? "bg-gradient-to-r from-brand-light to-brand text-white shadow-[0_2px_8px_-2px_rgba(99,102,241,0.55)]"
              : "bg-black/40 text-white"
          }`}
        >
          {event.status === "ongoing" ? "진행중" : "종료"}
        </span>
      </div>
      <h1 className="text-xl font-extrabold mb-1">{event.title}</h1>
      <p className="text-sm text-muted mb-5">{event.period}</p>
      <div className="card p-5 text-sm leading-relaxed">{event.description}</div>
    </div>
  );
}

export default function EventDetailPage() {
  return <EventDetailContent />;
}
