"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, LogOut, Megaphone, Menu, MessageCircle, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import Select from "@/components/ui/Select";
import { GNB_LINKS, GOODS_CATEGORIES, MYPAGE_LINKS, SIDEBAR_LINKS } from "@/lib/nav";
import { MANUFACTURERS, NOTICES } from "@/lib/mockData";

const GUEST_NAV_LINKS = [
  { href: "/factory-price", label: "공장도가 확인" },
  { href: "/main", label: "타이어 구매" },
  { href: "/sell", label: "타이어판매" },
  { href: "/goods", label: "정비용품 구매" },
  { href: "/events?tab=ongoing", label: "이벤트" },
  { href: "/exhibition", label: "기획전" },
];

const MOBILE_GUEST_NAV_LINKS = [
  { href: "/main", label: "홈" },
  { href: "/products", label: "타이어 상품목록" },
  { href: "/events?tab=ongoing", label: "이벤트" },
  { href: "/exhibition", label: "기획전" },
  { href: "/customer?tab=faq", label: "고객센터" },
];

export default function Header() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [searchManufacturer, setSearchManufacturer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isScrolled, setIsScrolled] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isAppScreen = pathname !== "/" && pathname !== "/login";
  const isMainDashboard = pathname === "/main";

  function handleGuestSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchManufacturer) params.set("manufacturer", searchManufacturer);
    if (searchQuery) params.set("size", searchQuery);
    router.push(`/login?redirect=/products${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const LAST_SEEN_NOTICE_KEY = "tirezone_last_seen_notice";

  useEffect(() => {
    if (NOTICES.length === 0) return;
    const lastSeen = localStorage.getItem(LAST_SEEN_NOTICE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage read after mount, required to avoid SSR/client markup mismatch
    setHasUnread(lastSeen !== NOTICES[0].id);
  }, []);

  useEffect(() => {
    if (!isMainDashboard) return;
    const handleScroll = () => setIsScrolled(window.scrollY > 18);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isMainDashboard]);

  function handleNotifOpenChange(open: boolean) {
    setNotifOpen(open);
    if (open && NOTICES[0]) {
      localStorage.setItem(LAST_SEEN_NOTICE_KEY, NOTICES[0].id);
      setHasUnread(false);
    }
  }

  const goodsCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [goodsOpen, setGoodsOpen] = useState(false);

  function openGoodsMenu() {
    if (goodsCloseTimeoutRef.current) {
      clearTimeout(goodsCloseTimeoutRef.current);
      goodsCloseTimeoutRef.current = null;
    }
    setGoodsOpen(true);
  }

  function scheduleCloseGoodsMenu() {
    goodsCloseTimeoutRef.current = setTimeout(() => setGoodsOpen(false), 150);
  }

  return (
    <header
      className={`sticky top-0 z-40 header-glass transition-[background-color,box-shadow] duration-300 ${
        isMainDashboard && isScrolled
          ? "!bg-white/90 shadow-[0_8px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl"
          : ""
      }`}
    >
      <div
        className={`relative mx-auto flex items-center justify-between gap-6 ${
          isMainDashboard
            ? `${isScrolled ? "h-14" : "h-16"} max-w-none px-4 transition-[height] duration-300 lg:h-[70px] lg:px-5`
            : "h-16 max-w-[1680px] px-4 lg:h-20"
        }`}
      >
        <div className="flex items-center gap-6">
          <button
            aria-label="메뉴 열기"
            onClick={() => setMenuOpen(true)}
            className="lg:hidden p-2 -ml-2 text-foreground/80 hover:text-brand"
          >
            <Menu size={22} />
          </button>

          <Link
            href={isAppScreen ? "/main" : "/"}
            className={`absolute left-1/2 flex -translate-x-1/2 items-center py-1 lg:static lg:translate-x-0 lg:py-2 ${
              isMainDashboard ? "lg:w-[234px]" : ""
            }`}
          >
            <Image
              src="/logo.svg"
              alt="타이어존"
              width={220}
              height={64}
              className={
                isMainDashboard
                  ? `${isScrolled ? "h-10" : "h-12"} w-auto transition-[height] duration-300 lg:h-12`
                  : "h-12 w-auto lg:h-14"
              }
              priority
            />
          </Link>

          {user ? (
            <nav className="hidden lg:flex items-center gap-5">
              {GNB_LINKS.map((link) => {
                const isMain = link.href === "/main";
                const path = link.href.split("?")[0];
                const active = pathname === path;
                if (path === "/goods") {
                  return (
                    <div
                      key={link.href}
                      className="relative h-16 flex items-center"
                      onMouseEnter={openGoodsMenu}
                      onMouseLeave={scheduleCloseGoodsMenu}
                    >
                      <Link
                        href={link.href}
                        className={`flex items-center gap-1 text-sm font-medium h-16 ${
                          active || pathname.startsWith("/goods")
                            ? "text-brand"
                            : "text-foreground/75 hover:text-brand"
                        }`}
                      >
                        {link.label}
                        {link.badge && (
                          <span className="text-[10px] font-bold text-accent border border-accent rounded px-1 leading-4">
                            {link.badge}
                          </span>
                        )}
                      </Link>
                      {goodsOpen && (
                        <div className="absolute top-full left-0 w-40 py-2 bg-surface border border-border rounded-lg shadow-[var(--shadow-md)] z-50">
                          {GOODS_CATEGORIES.map((c) => (
                            <Link
                              key={c.href}
                              href={c.href}
                              className="block px-4 py-2 text-sm text-foreground/80 hover:bg-surface-2 hover:text-brand"
                            >
                              {c.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                if (isMain) {
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="px-4 h-9 flex items-center rounded-md text-white text-sm font-bold bg-brand hover:bg-[var(--brand-dark)]"
                    >
                      {link.label}
                    </Link>
                  );
                }
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`text-sm font-medium ${
                      active ? "text-brand" : "text-foreground/75 hover:text-brand"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          ) : (
            <form
              onSubmit={handleGuestSearch}
              className="hidden md:flex items-center border border-border rounded-lg overflow-hidden h-10"
            >
              <Select
                value={searchManufacturer}
                onValueChange={setSearchManufacturer}
                items={[
                  { value: "", label: "통합검색" },
                  ...MANUFACTURERS.map((m) => ({ value: m, label: m })),
                ]}
                ariaLabel="제조사 선택"
                className="h-full px-2.5 text-sm border-0 border-r border-border bg-surface focus:outline-none"
              />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="타이어 사이즈 또는 상품명 입력"
                className="h-full px-3 text-sm border-0 focus:outline-none w-64"
              />
              <button
                type="submit"
                aria-label="검색"
                className="h-full px-3 bg-brand text-white flex items-center justify-center hover:bg-[var(--brand-dark)]"
              >
                <Search size={16} />
              </button>
            </form>
          )}
        </div>

        {isAppScreen && NOTICES[0] && (
          <div
            className="hidden lg:flex items-center gap-1.5 flex-1 min-w-0 text-muted"
            aria-hidden="true"
          >
            <Megaphone size={14} className="shrink-0" />
            <div className="relative flex-1 min-w-0 h-4 overflow-hidden">
              <div
                className={`whitespace-nowrap text-xs ${
                  isMainDashboard
                    ? "w-full text-center"
                    : "absolute animate-[ticker_18s_linear_infinite]"
                }`}
              >
                {isMainDashboard
                  ? "(NEW) 타이어 구매를 편하게! 공장도가 계산 서비스 오픈!"
                  : NOTICES[0].title}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 shrink-0">
          {user && (
            <DropdownMenu.Root open={notifOpen} onOpenChange={handleNotifOpenChange}>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label={hasUnread ? "알림 (읽지 않음)" : "알림"}
                  className="relative hidden lg:flex flex-col items-center gap-0.5 text-foreground/70 hover:text-brand"
                >
                  <MessageCircle size={19} />
                  <span className="text-[10px] leading-none">알림</span>
                  {hasUnread && (
                    <span className="absolute top-0 right-0.5 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                    </span>
                  )}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="w-72 rounded-lg border border-border bg-surface shadow-[var(--shadow-lg)] py-1.5 z-50 data-[state=open]:animate-[slide-in-from-top_180ms_ease-out] data-[state=closed]:animate-[slide-out-to-top_150ms_ease-in]"
                >
                  <p className="px-3 py-2 text-xs font-semibold text-muted border-b border-border">
                    공지사항
                  </p>
                  {NOTICES.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted text-center">새 알림이 없습니다.</p>
                  ) : (
                    NOTICES.map((n) => (
                      <DropdownMenu.Item
                        key={n.id}
                        className="px-3 py-2 hover:bg-surface-2 outline-none cursor-default"
                      >
                        <p className="text-xs text-foreground/90 leading-snug">{n.title}</p>
                        <p className="text-[11px] text-muted mt-0.5">{n.date}</p>
                      </DropdownMenu.Item>
                    ))
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}

          {user && (
            <div className="hidden lg:flex flex-col items-start leading-tight pl-3 border-l border-border">
              <Link
                href="/mypage/status"
                className="text-xs font-semibold text-foreground truncate max-w-[140px] hover:text-brand"
              >
                {user.businessName}
              </Link>
              {(user.role === "ADMIN" || user.role === "SELLER") && (
                <Link
                  href={user.role === "ADMIN" ? "/admin" : "/seller"}
                  className="text-[11px] text-brand hover:underline"
                >
                  {user.role === "ADMIN" ? "관리자 페이지" : "판매자센터"}
                </Link>
              )}
              <Link href="/mypage/settings" className="text-[11px] text-brand hover:underline">
                회원정보수정
              </Link>
            </div>
          )}

          {user ? (
            <button
              aria-label="로그아웃"
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f6f8] text-foreground/70 hover:text-accent lg:-m-2.5 lg:bg-transparent"
              title="로그아웃"
            >
              <LogOut size={20} />
            </button>
          ) : (
            <div className="flex items-center gap-3 text-sm font-medium">
              <Link href="/login" className="text-foreground/70 hover:text-brand">
                로그인
              </Link>
              <Link href="/login" className="hidden sm:inline text-foreground/70 hover:text-brand">
                회원가입
              </Link>
            </div>
          )}
        </div>
      </div>

      {!user && !isAppScreen && (
        <div className="hidden lg:block border-t border-border">
          <div className="max-w-[1680px] mx-auto flex items-center justify-between px-4 h-11">
            <nav className="flex items-center gap-5">
              {GUEST_NAV_LINKS.map((link) => {
                const active = pathname === link.href.split("?")[0];
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`text-sm font-medium ${active ? "text-brand" : "text-foreground/70 hover:text-brand"}`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="flex items-center gap-4 text-xs text-muted">
              <span>
                등록 업체수 <b className="text-foreground">4,612</b>
              </span>
              <span>
                누적 거래수량 <b className="text-foreground">716,642</b>
              </span>
            </div>
          </div>
        </div>
      )}

      <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50 lg:hidden data-[state=open]:animate-[overlay-show_200ms_ease-out] data-[state=closed]:animate-[overlay-hide_180ms_ease-in]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 w-72 max-w-[85%] bg-surface shadow-[var(--shadow-lg)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] flex flex-col gap-1 overflow-y-auto z-50 lg:hidden data-[state=open]:animate-[slide-in-from-left_250ms_ease-out] data-[state=closed]:animate-[slide-out-to-left_200ms_ease-in]"
          >
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="font-bold text-brand text-lg">메뉴</Dialog.Title>
              <Dialog.Close asChild>
                <button aria-label="닫기" className="p-2 -mr-2 text-muted hover:text-foreground">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>

            {user ? (
              <>
                <div className="mb-4 p-3 rounded-lg bg-background text-sm flex items-center justify-between">
                  <Link
                    href="/mypage/status"
                    onClick={() => setMenuOpen(false)}
                    className="font-semibold hover:text-brand"
                  >
                    {user.businessName}
                  </Link>
                  {(user.role === "ADMIN" || user.role === "SELLER") && (
                    <Link
                      href={user.role === "ADMIN" ? "/admin" : "/seller"}
                      onClick={() => setMenuOpen(false)}
                      className="text-xs text-brand hover:underline whitespace-nowrap"
                    >
                      {user.role === "ADMIN" ? "관리자 페이지" : "판매자센터"}
                    </Link>
                  )}
                  <Link
                    href="/mypage/settings"
                    onClick={() => setMenuOpen(false)}
                    className="text-xs text-brand hover:underline"
                  >
                    회원정보수정
                  </Link>
                </div>

                {GNB_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={`px-3 py-3 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
                      pathname === link.href.split("?")[0]
                        ? "bg-brand/10 text-brand"
                        : "hover:bg-surface-2"
                    }`}
                  >
                    {link.label}
                    {link.badge && (
                      <span className="text-[10px] font-bold text-accent border border-accent rounded px-1 leading-4">
                        {link.badge}
                      </span>
                    )}
                  </Link>
                ))}

                <div className="my-2 border-t border-border" />

                {SIDEBAR_LINKS.map((link) => {
                  const active = pathname === link.href.split("?")[0];
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className={`px-3 py-3 rounded-lg text-sm font-medium ${
                        active ? "bg-brand/10 text-brand" : "hover:bg-surface-2"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}

                <p className="px-3 pt-3 pb-1 text-sm font-semibold text-foreground flex items-center gap-1">
                  마이페이지 <ChevronRight size={15} />
                </p>
                <div className="pl-3 flex flex-col gap-0.5 border-l border-border ml-3">
                  {MYPAGE_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="px-3 py-2.5 rounded-lg text-sm text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <>
                {MOBILE_GUEST_NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="px-3 py-3 rounded-lg text-sm font-medium hover:bg-surface-2"
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="btn-primary mt-2 h-11 px-3 text-sm text-center"
                >
                  로그인
                </Link>
                <div className="mt-4 pt-4 border-t border-border flex flex-col gap-1 text-xs text-muted">
                  <span>
                    등록 업체수 <b className="text-foreground">4,612</b>
                  </span>
                  <span>
                    누적 거래수량 <b className="text-foreground">716,642</b>
                  </span>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
  );
}
