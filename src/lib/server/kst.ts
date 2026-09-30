// ---------------------------------------------------------------------------
// 정산(payout.ts)·구매자 월별 매출(settlement.ts)·세금계산서 귀속월
// (taxInvoice.ts) 월귀속의 단일 기준. 셋 중 하나만 다른 관행을 쓰면 월 경계
// 몇 시간 차이로 서로 어긋난다 — 반드시 이 모듈의 함수로만 월/기간을
// 산출할 것.
//
// 한국은 서머타임이 없으므로 고정 +9h 오프셋이 항상 정확하다. 서버 TZ 환경
// 변수에 의존하지 말 것(런타임 설정에 따라 흔들린다) — 모든 계산은 명시적
// 오프셋 산술로 한다.
// ---------------------------------------------------------------------------

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// instant 가 속한 KST 달력 월("YYYY-MM").
export function kstMonthString(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7);
}

// now 가 속한 KST 달력 월의 시작 시점(UTC instant)과 now 를 [start, end) 로.
export function currentKstMonthPeriod(now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - KST_OFFSET_MS);
  return { start, end: now };
}

// "YYYY-MM-DD" 를 KST 자정으로 해석한 UTC instant. payout.ts 의 기존
// parseDateOnly 와 동일 수준의 형식 검증만 한다(실존하지 않는 날짜, 예:
// 2026-02-30, 을 걸러내지는 않고 Date.UTC 가 다음 달로 굴리는 동작을 그대로
// 둔다 — 기존 동작과 동일한 수준을 유지하기 위함이며 이 함수에서 새로
// 개선하지 않는다). Date.UTC(y, m-1, d) 는 "그 날짜의 UTC 자정"을 뜻하므로,
// 그 값에서 KST_OFFSET_MS 를 빼면 "그 날짜의 KST 자정"에 해당하는 UTC
// instant 가 된다 (KST 00:00 == UTC 전날 15:00).
export function parseKstDateOnly(value: string): Date | null {
  if (!DATE_ONLY_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d) - KST_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}
