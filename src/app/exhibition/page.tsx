"use client";

import { Gift } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ExhibitionPage() {
  const { user } = useAuth();

  return (
    <div className="px-4 py-16 flex justify-center">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center mx-auto mb-4">
          <Gift size={26} />
        </div>
        <h1 className="text-xl font-extrabold mb-2">기획전</h1>
        <p className="text-sm text-muted leading-relaxed">
          {user
            ? "현재 진행 중인 기획전이 없습니다. 새로운 기획전이 열리면 공지사항으로 안내드릴게요."
            : "브랜드별 특가 기획전을 준비 중입니다. 로그인하시면 진행중인 이벤트도 함께 확인하실 수 있어요."}
        </p>
      </div>
    </div>
  );
}
