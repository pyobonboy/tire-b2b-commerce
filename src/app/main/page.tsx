"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronRight,
  CircleDot,
  Clock,
  LockKeyhole,
  Search,
  ThumbsUp,
} from "lucide-react";
import HeroCarousel from "@/components/HeroCarousel";
import ImagePlaceholder from "@/components/ImagePlaceholder";
import Carousel from "@/components/Carousel";
import Select from "@/components/ui/Select";
import type { Tire } from "@/lib/types";
import {
  DIRECT_NOTICE,
  EVENTS,
  EVENT_BANNER_IMAGES,
  FAQ_CATEGORIES,
  MANUFACTURERS,
  NOTICES,
  TIRES,
  UPDATE_LOGS,
} from "@/lib/mockData";
import { useOrders } from "@/lib/orders";
import { formatTireSize, parseTireSize } from "@/lib/tireSearch";
import { useAuth } from "@/lib/auth";

function DashboardTireCard({ tire, mobile = false }: { tire: Tire; mobile?: boolean }) {
  const { user } = useAuth();

  return (
    <Link
      href={`/products/${tire.id}`}
      className={`group shrink-0 flex flex-col rounded-2xl text-[#20242a] transition-[transform,filter] duration-200 active:scale-[0.975] active:brightness-[0.98] ${
        mobile ? "w-[168px]" : "w-[145px]"
      }`}
    >
      <ImagePlaceholder
        manufacturer={tire.manufacturer}
        className={`mb-3 !border-0 bg-gradient-to-b from-white via-[#fbfcfd] to-[#eef2f6] p-4 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.045)] transition-transform duration-300 group-hover:-translate-y-0.5 ${
          mobile ? "h-[104px] w-[168px] !rounded-2xl" : "h-[92px] w-[145px] !rounded-xl"
        }`}
      />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-[#7a818c]">{tire.manufacturer}</span>
        {tire.tag && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide ${
              tire.tag === "EVENT"
                ? "bg-orange-50 text-[#e66f0e]"
                : "bg-blue-50 text-brand"
            }`}
          >
            {tire.tag}
          </span>
        )}
      </div>
      <p className="h-[38px] text-[15px] font-bold leading-[19px] tracking-[-0.02em] line-clamp-2 transition-colors group-hover:text-brand">
        {tire.model}
      </p>
      <p className="mt-1.5 text-[12px] leading-[17px] text-[#717782]">
        {tire.width} / {tire.ratio} R {tire.rim} · DOT {tire.dot}
      </p>
      <div className="mt-2.5 flex min-h-[44px] items-end gap-2 border-t border-[#e7eaf0] pt-2.5 whitespace-nowrap">
        <strong className="text-[28px] font-extrabold leading-none tracking-[-0.055em] text-[#1748c7]">
          {tire.discountRate}
          <span className="ml-0.5 text-[13px]">%</span>
        </strong>
        <div className="min-w-0 pb-0.5">
          {user ? (
            <strong className="block text-[16px] font-extrabold leading-[20px] text-[#252a31]">
              {tire.price.toLocaleString()}
              <span className="ml-0.5 text-[11px] font-semibold">원</span>
            </strong>
          ) : (
            <span className="block text-[11px] font-bold leading-[15px] text-brand">
              로그인 후
              <br />
              회원가 확인
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function DesktopProductSection({
  title,
  href,
  tires,
  kind,
}: {
  title: string;
  href: string;
  tires: Tire[];
  kind: "event" | "best";
}) {
  const Icon = kind === "event" ? Bell : ThumbsUp;
  const { user } = useAuth();

  return (
    <section className="h-[350px] min-w-0 overflow-hidden rounded-[18px] border border-[#e3e7ed] bg-white px-6 pt-5 shadow-[0_8px_26px_-20px_rgba(15,23,42,0.32)]">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[19px] font-bold tracking-[-0.025em]">
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${kind === "event" ? "bg-orange-50 text-[#ee7b1a]" : "bg-blue-50 text-brand"}`}>
            <Icon size={17} strokeWidth={1.8} />
          </span>
          {title}
        </h2>
        <Link href={href} className="flex items-center text-[12px] font-medium text-[#777f8a] hover:text-brand">
          전체보기 <ChevronRight size={14} />
        </Link>
      </div>
      <div className={`grid gap-5 px-1 ${user ? "grid-cols-3" : "grid-cols-4"}`}>
        {tires.slice(0, user ? 3 : 4).map((tire) => (
          <DashboardTireCard key={tire.id} tire={tire} />
        ))}
      </div>
    </section>
  );
}

function MobileProductSection({
  title,
  href,
  tires,
  kind,
}: {
  title: string;
  href: string;
  tires: Tire[];
  kind: "event" | "best";
}) {
  const Icon = kind === "event" ? Bell : ThumbsUp;

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#e3e7ed] bg-white py-4 shadow-[0_10px_28px_-22px_rgba(15,23,42,0.35)]">
      <div className="mb-4 flex items-center justify-between px-4">
        <h2 className="flex items-center gap-2 text-[17px] font-bold">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full ${
              kind === "event" ? "bg-orange-50 text-[#ee7b1a]" : "bg-blue-50 text-brand"
            }`}
          >
            <Icon size={17} strokeWidth={1.8} />
          </span>
          {title}
        </h2>
        <Link href={href} className="flex items-center text-xs text-[#777]">
          전체보기 <ChevronRight size={14} />
        </Link>
      </div>
      <Carousel
        autoPlayInterval={kind === "event" ? 3200 : 3600}
        className="max-w-none px-4"
      >
        {tires.map((tire) => (
          <DashboardTireCard key={tire.id} tire={tire} mobile />
        ))}
      </Carousel>
    </section>
  );
}

function MainContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [manufacturer, setManufacturer] = useState("");
  const [size, setSize] = useState("");
  const mobileFeedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const feed = mobileFeedRef.current;
    if (!feed) return;

    const elements = Array.from(feed.querySelectorAll<HTMLElement>(".mobile-reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -24px" },
    );

    elements.forEach((element, index) => {
      element.style.transitionDelay = `${Math.min(index * 45, 180)}ms`;
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const { orders } = useOrders();
  const eventTires = TIRES.filter((t) => t.tag === "EVENT");
  const bestTires = TIRES.filter((t) => t.tag === "BEST");
  const desktopEventTires: Tire[] = [
    {
      ...eventTires[0],
      width: 235,
      ratio: 40,
      rim: 19,
      dot: "2025",
      discountRate: 55,
      price: 204900,
    },
    {
      ...eventTires[5],
      width: 245,
      ratio: 45,
      rim: 19,
      dot: "2026",
      discountRate: 55,
      price: 142500,
    },
    {
      ...eventTires[2],
      width: 175,
      ratio: 50,
      rim: 15,
      dot: "2025",
      discountRate: 55,
      price: 66800,
    },
    {
      ...eventTires[3],
      width: 175,
      ratio: 65,
      rim: 15,
      dot: "2025",
      discountRate: 55,
      price: 63800,
    },
    ...eventTires.slice(4, 5),
  ];
  const desktopBestTires: Tire[] = [
    bestTires[0],
    { ...bestTires[4], discountRate: 47, price: 38980 },
    { ...bestTires[3], width: 255, ratio: 45, rim: 20, discountRate: 60, price: 169980 },
    { ...bestTires[5], width: 245, ratio: 40, rim: 19, discountRate: 42, price: 215600 },
    { ...bestTires[2], discountRate: 37 },
    ...bestTires.slice(6),
  ];
  const recentOrders = orders.slice(0, 4);
  const ongoingEvents = EVENTS.filter((e) => e.status === "ongoing").sort((a, b) =>
    a.id === "e2" ? -1 : b.id === "e2" ? 1 : 0,
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (manufacturer) params.set("manufacturer", manufacturer);
    const parsedSize = parseTireSize(size);
    if (parsedSize) params.set("size", formatTireSize(parsedSize));
    else if (size.trim()) params.set("size", size.trim());
    router.push(`/products?${params.toString()}`);
  }

  const banner = (
    <HeroCarousel
      className="shadow-[var(--shadow-lg)]"
      autoPlayInterval={4000}
      showControls={false}
      slides={ongoingEvents.map((ev) => {
        const bannerImage = EVENT_BANNER_IMAGES[ev.id];
        return {
          key: ev.id,
          content: (
            <Link href={`/events/${ev.id}`} className="relative block w-full h-full">
              {bannerImage ? (
                <>
                  <Image
                    src={bannerImage}
                    alt={ev.title}
                    fill
                    priority
                    className="object-cover"
                    sizes="(min-width: 1024px) 700px, 100vw"
                  />
                  {ev.id !== "e2" && (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/5 to-transparent" />
                      <div className="absolute inset-0 flex items-end px-6 pb-6 text-left">
                        <div>
                          <p className="text-xs font-bold text-white/80">진행중 이벤트</p>
                          <p className="text-xl font-extrabold text-white mt-1">{ev.title}</p>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div
                  className="w-full h-full flex items-center px-6 text-left"
                  style={{ background: ev.bannerGradient }}
                >
                  <div>
                    <p className="text-xs font-bold text-black/60">진행중 이벤트</p>
                    <p className="text-xl font-extrabold text-black/80 mt-1">{ev.title}</p>
                  </div>
                </div>
              )}
            </Link>
          ),
        };
      })}
    />
  );

  const directBanner = user ? (
    <Link href="/direct" className="card p-5 text-center block card-hover">
      <p className="text-sm text-muted mb-1">{DIRECT_NOTICE}</p>
      <h2 className="text-base font-extrabold">
        타이어 <span className="text-brand">당일 직배송</span> 주문으로~!
      </h2>
    </Link>
  ) : (
    <div className="card p-5 text-center">
      <p className="text-sm text-muted mb-1">사업자 회원 전용 가격과 직배송 서비스를 이용해보세요.</p>
      <h2 className="text-base font-extrabold">
        로그인하면 <span className="text-brand">공장도가·재고·회원가</span>를 확인할 수 있습니다.
      </h2>
      <Link href="/login?redirect=/main" className="btn-primary mt-4 h-10 px-5 text-sm">
        로그인하고 회원 혜택 보기
      </Link>
    </div>
  );

  const noticesBox = (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">공지사항</h2>
        <Link href="/customer?tab=notice" className="text-xs text-muted flex items-center">
          전체보기 <ChevronRight size={14} />
        </Link>
      </div>
      <div className="card divide-y divide-border">
        {NOTICES.slice(0, 4).map((n) => (
          <div
            key={n.id}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2"
          >
            <span className="truncate">{n.title}</span>
            <span className="text-muted text-xs shrink-0 ml-3">{n.date}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const faqBox = (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">자주묻는 질문</h2>
        <Link href="/customer?tab=faq" className="text-xs text-muted flex items-center">
          전체보기 <ChevronRight size={14} />
        </Link>
      </div>
      <div className="card grid grid-cols-3 gap-1 p-3">
        {FAQ_CATEGORIES.map((c) => (
          <Link
            key={c.id}
            href="/customer?tab=faq"
            className="flex flex-col items-center gap-1 py-2 rounded-lg hover:bg-surface-2 text-center"
          >
            <span className="text-xs font-medium">{c.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );

  const updateBox = (
    <section className="pb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">업데이트 내역</h2>
        <Link href="/customer?tab=update" className="text-xs text-muted flex items-center">
          전체보기 <ChevronRight size={14} />
        </Link>
      </div>
      <div className="card divide-y divide-border">
        {UPDATE_LOGS.slice(0, 4).map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-2"
          >
            <span className="truncate">{u.title}</span>
            <span className="text-muted text-xs shrink-0 ml-3">{u.date}</span>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
      {/* Mobile / tablet: single stacked column */}
      <div ref={mobileFeedRef} className="flex flex-col gap-5 px-4 pt-4 pb-24 lg:hidden">
        <div className="mobile-reveal [&>div]:h-[170px] [&>div]:rounded-2xl [&>div]:shadow-[0_10px_30px_rgba(225,29,72,0.16)]">
          {banner}
        </div>

        <section className="mobile-reveal rounded-2xl border border-white/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-brand">
              <CircleDot size={17} />
            </span>
            타이어 검색
          </h2>
          <form onSubmit={handleSearch}>
            <div className="mb-3 flex h-11 overflow-hidden rounded-xl border border-[#d9dee7] bg-white">
              <Select
                value={manufacturer}
                onValueChange={setManufacturer}
                items={[
                  { value: "", label: "제조사" },
                  ...MANUFACTURERS.map((m) => ({ value: m, label: m })),
                ]}
                ariaLabel="제조사"
                className="w-[108px] shrink-0 border-0 border-r border-[#d9dee7] px-3 text-sm focus:outline-none"
              />
              <input
                value={size}
                onChange={(e) => setSize(e.target.value)}
                aria-label="타이어 사이즈"
                placeholder="사이즈 245 45 18"
                className="min-w-0 flex-1 border-0 px-3 text-sm focus:outline-none"
              />
            </div>
            <button type="submit" className="btn-primary h-11 w-full rounded-xl text-[15px]">
              <Search size={17} className="mr-1.5" /> 검색하기
            </button>
          </form>
        </section>

        {!user && (
          <div className="mobile-reveal grid grid-cols-3 divide-x divide-[#e7eaf0] rounded-2xl border border-[#e5e8ed] bg-white px-2 py-3 text-center shadow-[0_6px_20px_-18px_rgba(15,23,42,0.4)]">
            <div>
              <strong className="block text-[14px] text-[#20242a]">4,612</strong>
              <span className="text-[10px] text-muted">등록 업체</span>
            </div>
            <div>
              <strong className="block text-[14px] text-[#20242a]">716,642</strong>
              <span className="text-[10px] text-muted">누적 거래</span>
            </div>
            <div>
              <strong className="block text-[14px] text-[#20242a]">당일 가능</strong>
              <span className="text-[10px] text-muted">직배송 서비스</span>
            </div>
          </div>
        )}

        {user ? (
          <section className="mobile-reveal order-3 overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between border-b border-[#edf0f4] px-4 py-3.5">
              <h2 className="flex items-center gap-2 text-[16px] font-bold">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-brand">
                  <Clock size={17} />
                </span>
                최근 주문 내역
              </h2>
              <Link href="/mypage/orders" className="flex items-center text-xs text-[#777]">
                전체보기 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="divide-y divide-[#edf0f4]">
              {recentOrders.map((order, index) => (
                <Link
                  key={order.id}
                  href="/mypage/orders"
                  className="grid min-h-[48px] grid-cols-[104px_1fr_auto] items-center gap-2 px-4 text-[13px] active:bg-[#f7f9fc]"
                >
                  <span className="truncate tabular-nums text-[#777]">{order.orderNo ?? order.id}</span>
                  <span className="truncate font-semibold text-[#075bea]">{order.model}</span>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      index === 1
                        ? "bg-slate-100 text-slate-500"
                        : index === 2
                          ? "bg-rose-50 text-rose-500"
                          : "bg-emerald-50 text-emerald-500"
                    }`}
                  >
                    {order.status}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : (
          <section className="mobile-reveal order-3 rounded-2xl border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-5 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <LockKeyhole size={24} className="mx-auto mb-2 text-brand" />
            <h2 className="text-[16px] font-bold">주문 현황은 회원 전용입니다</h2>
            <p className="mt-1 text-[13px] text-muted">로그인 후 주문·배송 현황을 안전하게 확인하세요.</p>
            <Link href="/login?redirect=/main" className="btn-primary mt-4 h-10 w-full text-sm">
              로그인
            </Link>
          </section>
        )}

        <div className="mobile-reveal order-1">
          <MobileProductSection
          title="이벤트 진행 중 타이어"
          href="/products?tag=EVENT"
          tires={desktopEventTires}
            kind="event"
          />
        </div>
        <div className="mobile-reveal order-2">
          <MobileProductSection
          title="판매 인기 타이어"
          href="/products"
          tires={desktopBestTires}
            kind="best"
          />
        </div>

        <div className="mobile-reveal order-4 [&_.card]:rounded-2xl">{directBanner}</div>
        <div className="mobile-reveal order-5 flex flex-col gap-5">
          {noticesBox}
          {faqBox}
          {updateBox}
        </div>
      </div>
      {/* Desktop: tireping-style full-width dashboard */}
      <div className="mx-auto hidden w-full max-w-[1480px] lg:grid grid-cols-[minmax(0,1fr)_380px] gap-x-6 gap-y-7 px-7 pt-8 pb-10">
        <div className="[&>div]:h-[388px] [&>div]:rounded-[16px] [&>div]:shadow-none">{banner}</div>

        <aside className="flex flex-col gap-[18px]">
          <section className="h-[170px] rounded-[16px] border border-[#e5e7eb] bg-white p-7 shadow-[0_2px_7px_rgba(0,0,0,0.03)]">
            <h2 className="mb-4 flex items-center gap-1.5 text-[20px] font-medium">
              <CircleDot size={19} className="text-[#334155]" />
              타이어 검색
            </h2>
            <form onSubmit={handleSearch}>
              <div className="mb-3 flex h-[38px] overflow-hidden rounded-[6px] border border-[#d9dee7]">
                <Select
                  value={manufacturer}
                  onValueChange={setManufacturer}
                  items={[
                    { value: "", label: "제조사" },
                    ...MANUFACTURERS.map((m) => ({ value: m, label: m })),
                  ]}
                  ariaLabel="제조사"
                  className="w-[153px] border-0 border-r border-[#d9dee7] px-3 text-[14px] focus:outline-none"
                />
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  placeholder="사이즈 검색 245 45 18"
                  className="min-w-0 flex-1 border-0 px-3 text-[14px] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="btn-primary h-[35px] w-full rounded-[5px] text-[15px]"
              >
                <Search size={17} className="mr-1" /> 검색하기
              </button>
            </form>
          </section>

          {user ? (
          <section className="h-[202px] overflow-hidden rounded-[16px] border border-[#e5e7eb] bg-white px-7 pt-5 shadow-[0_2px_7px_rgba(0,0,0,0.03)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[18px] font-medium">
                <Clock size={18} strokeWidth={1.8} />
                최근 주문 내역
              </h2>
              <Link href="/mypage/orders" className="flex items-center text-[13px] text-[#555]">
                전체보기 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="space-y-1.5">
              {recentOrders.map((order, index) => (
                <div
                  key={order.id}
                  className="grid grid-cols-[104px_1fr_auto] items-center gap-2 text-[13px] leading-6"
                >
                  <span className="truncate tabular-nums text-[#555]">{order.orderNo ?? order.id}</span>
                  <span className="truncate font-medium text-[#075bea]">{order.model}</span>
                  <span
                    className={`text-[12px] font-medium ${
                      index === 1
                        ? "text-[#1671f9]"
                        : index === 2
                          ? "text-[#ff4c34]"
                          : "text-[#ff7a21]"
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
          ) : (
            <section className="flex h-[202px] flex-col items-center justify-center rounded-[16px] border border-blue-100 bg-gradient-to-br from-white to-blue-50 px-7 text-center shadow-[0_2px_7px_rgba(0,0,0,0.03)]">
              <LockKeyhole size={25} className="mb-2 text-brand" />
              <h2 className="text-[18px] font-semibold">회원 전용 주문 현황</h2>
              <p className="mt-1 text-[13px] text-muted">로그인 후 최근 주문과 배송 상태를 확인하세요.</p>
              <Link href="/login?redirect=/main" className="btn-primary mt-4 h-9 px-5 text-sm">
                로그인
              </Link>
            </section>
          )}
        </aside>

        <div className="col-span-2 grid min-w-0 grid-cols-2 gap-5">
          <DesktopProductSection
            title="이벤트 진행 중 타이어"
            href="/products?tag=EVENT"
            tires={desktopEventTires}
            kind="event"
          />
          <DesktopProductSection
            title="판매 인기 타이어"
            href="/products"
            tires={desktopBestTires}
            kind="best"
          />
        </div>

        <div className="col-span-2 mt-[-2px]">
          {directBanner}
          <div className="mt-8 grid grid-cols-3 gap-4">
            {noticesBox}
            {faqBox}
            {updateBox}
          </div>
        </div>

        <Link
          href="/customer?tab=qna"
          aria-label="채팅문의"
          className="fixed bottom-3 right-3 z-30 flex h-16 w-16 flex-col items-center justify-center rounded-full border-4 border-[#ffe600] bg-[#3c1e1e] text-[11px] font-extrabold leading-tight text-[#ffe600] shadow-lg"
        >
          TALK
          <span>채팅문의</span>
        </Link>
      </div>
    </>
  );
}

export default function MainPage() {
  return <MainContent />;
}
