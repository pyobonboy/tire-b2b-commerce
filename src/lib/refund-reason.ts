// Payment.refundReason 은 코드가 어느 경로에서 환불 상태를 기록했는지 알아보게
// 하려고 내부 문자열 상수(RETURN_COMPLETED_NEEDS_MANUAL_REFUND 등)로 저장한다.
// 그 값이 관리자 주문 화면의 "환불 필요" 배지에 그대로 노출돼, 운영자가
// RETURN_COMPLETED_NEEDS_MANUAL_REFUND 같은 영문 코드를 읽어야 했다. 여기서
// 각 코드를 "무엇을, 왜 해야 하는지"가 담긴 한국어로 옮긴다.
//
// 이 맵의 키는 실제로 코드가 쓰는 문자열과 정확히 같아야 한다:
//   - RETURN_REFUND_REASON              (src/lib/server/returns.ts)
//   - AUTO_REFUND_TOSS_FAILURE_REASON   (src/lib/server/orders.ts)
//   - settleOrderRefundViaToss / cancelOrder 의 리터럴들 (orders.ts)
//   - toss/confirm 의 리터럴 (api/payments/toss/confirm/route.ts)
// 새 사유를 추가하면 여기도 함께 넣을 것. 모르는 값이 오면 코드 원문을 그대로
// 보여줘(숨기지 않음) 운영자가 최소한 무엇인지 추적할 수 있게 한다.
const REFUND_REASON_LABEL: Record<string, string> = {
  // 자동 환불로 해결된 상태 — 조치 불필요
  FULLY_REFUNDED_VIA_TOSS_CANCEL: "전액 환불 완료",
  PARTIALLY_REFUNDED_VIA_TOSS_CANCEL: "부분 환불 완료",

  // 수동 조치가 필요한 상태 — 관리자가 토스 콘솔에서 처리해야 함
  RETURN_COMPLETED_NEEDS_MANUAL_REFUND: "반품 완료 — 수동 환불 필요",
  AUTO_REFUND_FAILED_NEEDS_MANUAL_TOSS_CANCEL: "자동 환불 실패 — 수동 환불 필요",

  // 취소 시 환불이 걸려 아직 처리 중인 상태
  ORDER_CANCELED_AFTER_PAYMENT: "결제 후 주문 취소 — 환불 처리 중",
  ALL_ORDERS_ON_PAYMENT_CANCELLED: "전체 주문 취소 — 환불 처리 중",
  ORDER_CANCELED_BEFORE_PAYMENT_CONFIRMED: "결제 승인 중 취소 — 수동 확인 필요",
};

/** 관리자 화면에 보여줄 환불 사유 문구. 매핑에 없으면 코드 원문을 그대로 반환. */
export function refundReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "사유 미기록";
  return REFUND_REASON_LABEL[reason] ?? reason;
}
