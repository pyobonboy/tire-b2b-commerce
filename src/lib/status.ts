const STATUS_STYLE: Record<string, string> = {
  입금대기: "bg-accent/10 text-accent",
  입금완료: "bg-brand/10 text-brand",
  주문확인: "bg-brand/10 text-brand",
  배송준비중: "bg-brand/10 text-brand",
  배송중: "bg-brand/10 text-brand",
  배송완료: "bg-success/10 text-success",
  구매확정: "bg-success/10 text-success",
  입금후취소: "bg-muted/10 text-muted",
  입금전취소: "bg-muted/10 text-muted",
  교환완료: "bg-muted/10 text-muted",
  반품완료: "bg-muted/10 text-muted",
  재고없음: "bg-muted/10 text-muted",
  상품미도착: "bg-accent/10 text-accent",
};

export function getStatusStyle(status: string): string {
  return STATUS_STYLE[status] ?? "bg-muted/10 text-muted";
}
