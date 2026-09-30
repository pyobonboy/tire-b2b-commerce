"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { useDialogs } from "@/components/ui/DialogProvider";
import { CartRequestError, useCart } from "@/lib/cart";

function CartContent() {
  const { items, removeItem, updateQuantity, clear } = useCart();
  const { confirm: confirmDialog, alert: alertDialog } = useDialogs();

  const total = items.reduce((sum, i) => sum + i.price * i.quantity + i.extraShipping, 0);

  async function handleClear() {
    if (
      await confirmDialog({
        title: "장바구니에 담긴 모든 상품을 삭제할까요?",
        destructive: true,
      })
    ) {
      try {
        await clear();
      } catch {
        await alertDialog({ title: "장바구니를 비우지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    }
  }

  async function runCartAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof CartRequestError && error.code === "CART_ITEM_NOT_FOUND"
          ? "장바구니 상품을 찾지 못했습니다. 새로고침 후 다시 시도해 주세요."
          : "장바구니를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      await alertDialog({ title: message });
    }
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-extrabold mb-1">타이어 장바구니</h1>
      <p className="text-sm text-muted mb-5">
        장바구니에 담긴 상품은 담거나 수량을 변경한 뒤 1시간 동안 그대로 두면 자동 삭제됩니다.
      </p>

      {items.length === 0 ? (
        <div className="card text-center py-16 animate-[fade-slide-up_400ms_ease-out_both]">
          <ShoppingCart size={32} className="mx-auto mb-3 text-border" strokeWidth={1.5} />
          <p className="text-muted mb-4">장바구니에 담은 상품이 없습니다.</p>
          <Link href="/products" className="text-brand font-semibold">
            타이어 검색하러 가기
          </Link>
        </div>
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto card">
            <table className="min-w-[880px] w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-muted border-b border-border">
                  <th className="py-3 px-4 font-medium">제조사</th>
                  <th className="py-3 px-4 font-medium">주문상품</th>
                  <th className="py-3 px-4 font-medium">사이즈</th>
                  <th className="py-3 px-4 font-medium">생산년도</th>
                  <th className="py-3 px-4 font-medium">판매가</th>
                  <th className="py-3 px-4 font-medium">수량</th>
                  <th className="py-3 px-4 font-medium">합계금액</th>
                  <th className="py-3 px-4 font-medium">판매점</th>
                  <th className="py-3 px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-0 hover:bg-surface-2"
                  >
                    <td className="py-3 px-4">{item.manufacturer}</td>
                    <td className="py-3 px-4 font-medium">{item.model}</td>
                    <td className="py-3 px-4">
                      {item.width}/{item.ratio}R{item.rim}
                    </td>
                    <td className="py-3 px-4">{item.dot}</td>
                    <td className="py-3 px-4 tabular-nums">{item.price.toLocaleString()}원</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void runCartAction(() => updateQuantity(item.id, item.quantity - 1))}
                          aria-label="수량 감소"
                          disabled={item.quantity <= 1}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:bg-surface-2 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Minus size={13} />
                        </button>
                        <span
                          key={item.quantity}
                          className="w-6 text-center tabular-nums animate-[pop_250ms_ease-out]"
                        >
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => void runCartAction(() => updateQuantity(item.id, item.quantity + 1))}
                          aria-label="수량 증가"
                          disabled={item.stock !== undefined && item.quantity >= item.stock}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border hover:bg-surface-2 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-semibold tabular-nums">
                      {(item.price * item.quantity).toLocaleString()}원
                    </td>
                    <td className="py-3 px-4">{item.sellerCode}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => void runCartAction(() => removeItem(item.id))}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
                      >
                        <Trash2 size={13} /> 삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden flex flex-col gap-3">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="card p-4 animate-[fade-slide-up_400ms_ease-out_both]"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-muted mb-0.5">
                      {item.manufacturer} · {item.sellerCode}
                    </p>
                    <p className="font-semibold">{item.model}</p>
                    <p className="text-xs text-muted mt-1">
                      {item.width} / {item.ratio} R {item.rim} · DOT {item.dot}
                    </p>
                  </div>
                  <button
                    onClick={() => void runCartAction(() => removeItem(item.id))}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent shrink-0"
                  >
                    <Trash2 size={13} /> 삭제
                  </button>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void runCartAction(() => updateQuantity(item.id, item.quantity - 1))}
                      aria-label="수량 감소"
                      disabled={item.quantity <= 1}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-surface-2 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Minus size={14} />
                    </button>
                    <span
                      key={item.quantity}
                      className="w-8 text-center tabular-nums animate-[pop_250ms_ease-out]"
                    >
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => void runCartAction(() => updateQuantity(item.id, item.quantity + 1))}
                      aria-label="수량 증가"
                      disabled={item.stock !== undefined && item.quantity >= item.stock}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-surface-2 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <span className="font-bold tabular-nums">
                    {(item.price * item.quantity).toLocaleString()}원
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4 mt-5 flex items-center justify-between">
            <span className="font-semibold">합계금액</span>
            <span
              key={total}
              className="text-xl font-extrabold text-brand tabular-nums animate-[pop_280ms_ease-out]"
            >
              {total.toLocaleString()}원
            </span>
          </div>

          <div className="flex gap-2 mt-4 pb-8">
            <button
              onClick={() => void handleClear()}
              className="h-12 px-5 rounded-xl border border-border text-sm font-semibold hover:bg-surface-2 active:scale-95 transition-all"
            >
              전체삭제
            </button>
            <Link href="/checkout" className="btn-primary flex-1 h-12 flex items-center justify-center">
              주문하기
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function CartPage() {
  return (
    <RequireAuth>
      <CartContent />
    </RequireAuth>
  );
}
