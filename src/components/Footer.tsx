import Link from "next/link";
import { NOTICES } from "@/lib/mockData";

const QUICK_LINKS = [
  { href: "/customer", label: "회사소개" },
  { href: "/terms", label: "이용약관" },
  { href: "/seller-terms", label: "판매회원 이용약관" },
  { href: "/privacy", label: "개인정보 취급방침" },
  { href: "/refund-policy", label: "청약철회 및 교환·반품 정책" },
  { href: "/customer", label: "고객센터" },
  { href: "/customer?tab=qna", label: "문의하기" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border mt-10 pt-5 pb-7 px-4 text-xs text-muted leading-relaxed bg-surface">
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-4 pb-4 border-b border-border">
        {QUICK_LINKS.map((l, i) => (
          <Link key={i} href={l.href} className="hover:text-brand">
            {l.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div>
          <p className="font-extrabold text-foreground/80 text-sm tracking-tight mb-1.5">
            타이어존
          </p>
          <p>(주)타이어존 / 대표이사 김대표 / 사업자등록번호 000-00-00000</p>
          <p>
            통신판매업신고 제0000-경기000-00000호 / 개인정보관리책임자 :
            관리자(admin@tirezone.example)
          </p>
          <p>경기도 어딘가시 어딘가로 123 / 고객센터 : 1588-0000</p>
          <p className="mt-1">copyright ⓒ tirezone. 데모 사이트입니다.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 lg:gap-10">
          <div className="min-w-[220px]">
            <p className="text-foreground/70 font-semibold mb-1.5">공지사항</p>
            <ul className="flex flex-col gap-1">
              {NOTICES.slice(0, 3).map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3">
                  <Link href="/customer?tab=notice" className="truncate hover:text-brand">
                    {n.title}
                  </Link>
                  <span className="shrink-0">{n.date}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <p className="text-foreground/70 font-semibold">고객센터</p>
            <a
              href="tel:1588-0000"
              className="font-extrabold text-lg text-gradient-brand hover:opacity-80"
            >
              1588-0000
            </a>
            <p>평일 09:00 ~ 18:00 (주말·공휴일 제외)</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
