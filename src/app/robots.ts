import type { MetadataRoute } from "next";

// 사업자 전용(B2B) 타이어 거래소이므로 색인 정책을 사고(accident)가 아니라 의도로
// 정한다(TODO 22). 검증한 문서:
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/robots.md
// — `app/robots.ts`가 기본으로 export하는 함수 하나로 `Robots` 객체를 반환하면
// 되고, "요청 시점 API나 dynamic config를 쓰지 않는 한 기본적으로 캐시되는
// 특수 Route Handler"라고 명시되어 있다. 이 파일은 매 요청 계산이 필요 없는
// 정적인 규칙이라 그 기본 캐싱을 그대로 받아들인다(추가 설정 불필요).
//
// 카탈로그(/products, /goods, /direct, /factory-price, /exhibition, /events,
// /customer, /main, 루트 "/")는 비로그인 방문자에게도 제조사·모델명 정도는
// 보여주지만, 가격은 로그인 전까지 잠겨 있다(src/components/GuestTireCard.tsx의
// "로그인 후 확인" 참고). 즉 색인을 허용해도 실거래 정보가 새는 것은 아니고,
// 오히려 검색을 통한 신규 사업자 유입 경로로 쓸 수 있다. 그래서 공개
// 카탈로그/소개 페이지는 막지 않고, 로그인 이후에만 의미가 있는 화면과
// 운영 전용 화면만 명시적으로 제외한다.
export default function robots(): MetadataRoute.Robots {
// 가입 화면 두 개는 disallow 목록에서 되살린다. 위 논리대로 색인을 신규 사업자
// 유입 경로로 쓸 거라면, 정작 가입 진입점을 막아두는 것은 앞뒤가 맞지 않는다.
// `/seller`(판매자 대시보드)와 `/signup`(구매회원 가입)을 통째로 막으면
// `/seller/signup`과 `/signup`까지 함께 막히므로, 더 구체적인 경로를 allow에
// 명시해 되돌린다 — robots.txt에서는 더 구체적인 규칙이 우선한다.
// 로그인·계정복구 화면은 검색 유입 가치가 없으므로 그대로 막아둔다.
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/signup", "/seller/signup"],
      disallow: [
        "/admin",
        "/seller",
        "/mypage",
        "/orders",
        "/cart",
        "/api",
        "/reset-password",
        "/find-id",
        "/login",
      ],
    },
  };
}
