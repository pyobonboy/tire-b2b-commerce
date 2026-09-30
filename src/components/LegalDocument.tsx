import type { ReactNode } from "react";

// Shared shell for the four legal/policy pages (/terms, /seller-terms,
// /privacy, /refund-policy). Every one of these documents is a draft derived
// from reading this codebase, not a substitute for legal review — see the
// notice this component always renders at the top of every page that uses it.
export default function LegalDocument({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 py-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-extrabold mb-1.5">{title}</h1>
      {subtitle && <p className="text-sm text-muted mb-4">{subtitle}</p>}
      <p className="text-xs text-muted mb-6">
        시행일자 <Ph>시행일자</Ph>
      </p>

      <div className="card p-5 mb-6 border-accent/30 bg-accent/5">
        <p className="text-sm font-bold text-accent mb-1.5">
          본 문서는 법률 검토 전 초안입니다
        </p>
        <p className="text-xs leading-relaxed text-foreground/80">
          이 페이지는 서비스의 실제 코드(회원가입·주문·결제·배송·탈퇴 로직 등)를 근거로 자동 작성된 초안이며,
          변호사 등 법률 전문가의 자문을 대체하지 않습니다. 서비스를 실제로 오픈하기 전에 반드시 법률 전문가의
          검토를 거쳐야 하며,{" "}
          <span className="font-mono text-accent">{"{{ }}"}</span> 형태로 표시된 항목은 실제 값으로 채워 넣어야
          합니다.
        </p>
      </div>

      <article className="legal-content card p-6 md:p-8">{children}</article>
    </div>
  );
}

// Inline placeholder marker — every fact this repo cannot verify (company
// name, representative, address, contact points, effective date, etc.) is
// wrapped in this instead of being guessed at. Renders as {{항목명}}.
export function Ph({ children }: { children: ReactNode }) {
  return <span className="legal-placeholder">{"{{"}{children}{"}}"}</span>;
}
