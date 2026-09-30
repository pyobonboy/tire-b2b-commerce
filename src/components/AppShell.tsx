"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Sidebar from "./Sidebar";
import Footer from "./Footer";
import Breadcrumb from "./Breadcrumb";
import ScrollToTopButton from "./ScrollToTopButton";
import MobileBottomNav from "./MobileBottomNav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  // 경로 "구간" 단위로 비교한다. 단순 startsWith 는 이름이 같은 접두사로
  // 시작하는 다른 최상위 페이지까지 삼킨다 — 실제로 /seller-terms(푸터의
  // 판매회원 이용약관, 공개 페이지)가 startsWith("/seller") 에 걸려 판매자
  // 포털로 취급됐고, 그래서 형제 약관 페이지(/terms·/privacy)와 달리
  // 빵부스러기와 사이드바가 사라졌다.
  const inSection = (section: string) => pathname === section || pathname.startsWith(`${section}/`);
  const hasOwnSidebar =
    inSection("/goods") || inSection("/customer") || inSection("/seller") || inSection("/admin");
  const hasPortalShell = inSection("/seller") || inSection("/admin");
  const showAppShell = pathname !== "/login" && pathname !== "/";
  const showBreadcrumb = showAppShell && !hasPortalShell;
  const showSidebar = showAppShell && !hasOwnSidebar && Boolean(user);
  const showFooter = pathname !== "/login";
  const isMainDashboard = pathname === "/main";

  return (
    <div
      className={`flex-1 w-full flex flex-col ${
        isMainDashboard ? "max-w-none" : "max-w-[1680px] mx-auto"
      } ${showAppShell ? "pb-[80px] lg:pb-0" : ""} ${isMainDashboard ? "dashboard-canvas" : ""}`}
    >
      <div className="flex-1 flex">
        {showSidebar && <Sidebar />}
        <main className="flex-1 min-w-0">
          {showBreadcrumb && !isMainDashboard && <Breadcrumb />}
          <div
            key={`${pathname}-${loading}`}
            className={isMainDashboard ? "" : "animate-[fade-slide-up_320ms_ease-out_both]"}
          >
            {children}
          </div>
        </main>
      </div>
      {showFooter && <Footer />}
      <ScrollToTopButton />
      {showAppShell && !hasPortalShell && <MobileBottomNav />}
    </div>
  );
}
