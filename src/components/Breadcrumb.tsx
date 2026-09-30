"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  "/main": "홈",
  "/events": "이벤트",
  "/factory-price": "공장도가 확인",
  "/products": "일반 상품목록",
  "/direct": "당일직배송 상품목록",
  "/sell": "타이어판매",
  "/goods": "정비용품 구매",
  "/exhibition": "기획전",
  "/customer": "고객센터",
  "/wishlist": "찜한 판매업체",
  "/cart": "타이어 장바구니",
  "/mypage/status": "주문 / 배송 현황",
  "/mypage/orders": "주문내역 / 배송조회",
  "/mypage/returns": "교환 / 반품 신청내역",
  "/mypage/returns/new": "교환 / 반품 신청",
  "/mypage/addresses": "배송지 관리",
  "/mypage/deposits": "입출금 내역",
  "/mypage/extra-fees": "추가비용 내역",
  "/mypage/tax": "세금계산서 내역",
  "/mypage/settings": "회원정보수정",
  "/reviews/new": "구매후기 작성",
  "/checkout": "주문서 작성",
  "/orders/pay": "온라인 결제",
  "/orders/pay/success": "결제 결과",
  "/orders/pay/fail": "결제 실패",
  "/signup": "구매자 가입 신청",
  "/privacy": "개인정보처리방침",
  "/refund-policy": "청약철회 및 교환·반품 정책",
  "/terms": "이용약관 (구매회원)",
  "/seller-terms": "판매회원 이용약관",
  "/find-id": "아이디 찾기",
  "/reset-password": "비밀번호 재설정",
  "/reset-password/confirm": "비밀번호 재설정",
  "/reset-password/admin": "비밀번호 재설정 대기 목록",
};

const TOP_LEVEL = new Set(["/sell", "/goods", "/customer", "/exhibition"]);

function resolveLabel(pathname: string): string {
  if (LABELS[pathname]) return LABELS[pathname];
  if (pathname.startsWith("/products/")) return "상품 상세정보";
  if (pathname.startsWith("/events/")) return "이벤트 상세";
  return "타이어존";
}

export default function Breadcrumb() {
  const pathname = usePathname();
  const label = resolveLabel(pathname);
  const isTopLevel = TOP_LEVEL.has(pathname);

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted px-4 pt-3 lg:pt-4">
      <Link href="/main" className="hover:text-brand hover:underline underline-offset-2">
        HOME
      </Link>
      <ChevronRight size={14} />
      {isTopLevel ? (
        <span className="text-foreground font-medium">{label}</span>
      ) : (
        <>
          <Link href="/products" className="hover:text-brand hover:underline underline-offset-2">
            타이어 구매
          </Link>
          <ChevronRight size={14} />
          <span className="text-foreground font-medium">{label}</span>
        </>
      )}
    </nav>
  );
}
