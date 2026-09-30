"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Star } from "lucide-react";
import LoadingState from "@/components/LoadingState";
import RequireAuth from "@/components/RequireAuth";
import { formatDate } from "@/lib/formatDate";
import type { ReviewOrderContext, ReviewableOrderView } from "@/lib/review-types";

// Buyer-facing review write/edit flow. Lives on its own route (not on
// /mypage/orders, which this task cannot edit) — see the top-level report for
// the follow-up link that screen still needs. Reached two ways:
//   - /reviews/new?orderId=X : write (or edit, if one already exists) the
//     review for that specific order.
//   - /reviews/new           : pick which reviewable order to write about
//     first, then continues into the same flow above.

function StarRatingInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="평점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n}점`}
          onClick={() => onChange(n)}
          className="p-1 -m-1 active:scale-90 transition-transform"
        >
          <Star size={26} className={n <= value ? "text-accent" : "text-border"} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

function OrderPicker() {
  const [orders, setOrders] = useState<ReviewableOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reviews/reviewable-orders", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("주문 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ orders: ReviewableOrderView[] }>;
      })
      .then((data) => {
        if (!cancelled) setOrders(data.orders);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-accent">{error}</p>;
  if (!orders) return <LoadingState />;
  if (orders.length === 0) {
    return (
      <div className="card py-16 text-center text-sm text-muted">
        리뷰를 작성할 수 있는 주문이 없습니다.
        <br />
        배송완료 이후의 주문에 대해서만 리뷰를 작성할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => (
        <Link
          key={order.orderId}
          href={`/reviews/new?orderId=${encodeURIComponent(order.orderId)}`}
          className="card p-4 flex items-center justify-between gap-3 card-hover"
        >
          <div className="min-w-0">
            <p className="font-semibold truncate">
              {order.manufacturer} {order.model}
            </p>
            <p className="text-xs text-muted mt-1">
              {order.width}/{order.ratio} R {order.rim} · {order.sellerCode} · {formatDate(order.orderedAt)}
            </p>
          </div>
          <span className="text-brand text-sm font-semibold shrink-0">리뷰 작성 →</span>
        </Link>
      ))}
    </div>
  );
}

function ReviewForm({ orderId }: { orderId: string }) {
  const [context, setContext] = useState<ReviewOrderContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reviews/order/${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("주문 정보를 불러오지 못했습니다.");
        return response.json() as Promise<ReviewOrderContext>;
      })
      .then((data) => {
        if (cancelled) return;
        setContext(data);
        if (data.review) {
          setRating(data.review.rating);
          setContent(data.review.content);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setLoadError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!context) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const isEdit = Boolean(context.review);
      const response = await fetch(isEdit ? `/api/reviews/${context.review!.id}` : "/api/reviews", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { rating, content } : { orderId, rating, content }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setSubmitError(
          body?.error === "ORDER_NOT_ELIGIBLE"
            ? "배송완료 이후에만 리뷰를 작성할 수 있습니다."
            : body?.error === "REVIEW_ALREADY_EXISTS"
              ? "이미 이 주문에 대한 리뷰가 등록되어 있습니다."
              : "리뷰 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <p className="text-sm text-accent">{loadError}</p>;
  if (!context) return <LoadingState />;

  if (done) {
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold text-success mb-1">
          {context.review ? "리뷰가 수정되었습니다." : "리뷰가 등록되었습니다."}
        </p>
        <p className="text-sm text-muted mb-5">소중한 후기 감사합니다.</p>
        <Link href={`/products/${context.order.productId}`} className="btn-primary h-10 px-6 text-sm">
          상품으로 돌아가기
        </Link>
      </div>
    );
  }

  if (!context.eligible && !context.review) {
    return (
      <div className="card py-16 text-center text-sm text-muted">
        이 주문은 아직 리뷰를 작성할 수 없습니다.
        <br />
        배송완료 이후에 다시 시도해 주세요.
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="pb-4 mb-4 border-b border-border">
        <p className="font-semibold">
          {context.order.manufacturer} {context.order.model}
        </p>
        <p className="text-xs text-muted mt-1">
          {context.order.width}/{context.order.ratio} R {context.order.rim} · {context.order.sellerCode} ·{" "}
          {formatDate(context.order.orderedAt)}
        </p>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium mb-2">평점</p>
          <StarRatingInput value={rating} onChange={setRating} />
        </div>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          required
          minLength={1}
          maxLength={2000}
          rows={6}
          placeholder="상품과 배송에 대한 솔직한 후기를 남겨주세요."
          className="px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-none"
        />
        {submitError && <p className="text-sm text-accent font-medium">{submitError}</p>}
        <button type="submit" disabled={submitting} className="btn-primary h-11 self-end px-6 disabled:opacity-60">
          {submitting ? "저장 중..." : context.review ? "리뷰 수정" : "리뷰 등록"}
        </button>
      </form>
    </div>
  );
}

function NewReviewContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");

  return (
    <div className="px-4 py-5 max-w-2xl mx-auto">
      <Link href="/products" className="text-sm text-muted mb-4 inline-flex items-center gap-0.5">
        <ChevronLeft size={16} /> 상품 목록으로
      </Link>
      <h1 className="text-xl font-extrabold mb-1">{orderId ? "리뷰 작성" : "리뷰 작성할 주문 선택"}</h1>
      <p className="text-sm text-muted mb-5">
        {orderId ? "배송완료된 주문에 대한 솔직한 후기를 남겨주세요." : "리뷰를 남기고 싶은 주문을 선택해 주세요."}
      </p>
      {orderId ? <ReviewForm orderId={orderId} /> : <OrderPicker />}
    </div>
  );
}

export default function NewReviewPage() {
  return (
    <RequireAuth allow={["BUYER"]}>
      <Suspense fallback={<LoadingState />}>
        <NewReviewContent />
      </Suspense>
    </RequireAuth>
  );
}
