// 서버가 내려주는 타임스탬프(ISO 8601 UTC 문자열, 예: `Order.orderedAt.toISOString()`)를
// 화면에 찍을 때 쓰는 유일한 포맷터. 예전에는 `/mypage/orders` 와 `/orders` 가 이
// 값을 가공 없이 출력해 `2026-08-24T02:09:37.334Z` 로 보였고, UTC라 한국 사용자에게는
// 아홉 시간 어긋나 있었다.
//
// timeZone 을 "Asia/Seoul" 로 못 박은 이유:
// Intl 은 timeZone 을 주지 않으면 **실행 환경의 시간대**를 쓴다. 브라우저에서만
// 도는 화면이라면 대개 한국 시간이 나오지만, 그건 보는 사람의 기기 설정에 기대는
// 것이다. 사용자가 해외에 있으면 주문 시각이 현지 시간으로 보이고, 같은 함수가
// 서버(Render, UTC)에서 한 번이라도 렌더링되면 서버와 브라우저의 결과가 달라져
// 하이드레이션 불일치까지 난다. 한국 사업자 전용 거래소에서 주문·발송 시각은
// 보는 사람이 어디에 있든 KST 한 가지여야 하므로 고정한다.
const DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

const DATE_ONLY = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
});

/** 날짜 + 시각. 주문·발송처럼 몇 시에 일어났는지가 의미 있는 값에 쓴다. */
export function formatDate(value: string | Date) {
  return DATE_TIME.format(typeof value === "string" ? new Date(value) : value);
}

/**
 * 날짜만. 승인일·등록일처럼 시각까지는 필요 없는 값에 쓴다.
 * 화면마다 흩어져 있던 사본들이 이 형태였기 때문에 하나로 합치면서도
 * 표시 형식은 그대로 유지하려고 별도로 둔다 — 공용 함수 하나로 몰아넣으면
 * 기존 화면에 없던 시각이 갑자기 붙는다.
 */
export function formatDay(value: string | Date) {
  return DATE_ONLY.format(typeof value === "string" ? new Date(value) : value);
}
