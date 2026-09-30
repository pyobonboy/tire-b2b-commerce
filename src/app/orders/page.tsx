import { redirect } from "next/navigation";

// `/orders` is retired in favor of `/mypage/orders`, which now owns the full
// order-management UI (payment, cancellation, purchase confirmation,
// shipping/tracking, multi-order payment) this page used to provide on its
// own. This is a plain Server Component that redirects unconditionally.
//
// Why this can never swallow `/orders/pay`, `/orders/pay/success`, or
// `/orders/pay/fail`: Next's file-based App Router routing maps this file to
// exactly the `/orders` segment. `app/orders/pay/**` is a sibling page tree
// with its own `page.tsx` files and no `app/orders/layout.tsx` exists (see
// the source tree), so those routes never render through this component at
// all - there is nothing here that could "match" or wrap them. Verified by
// checking `src/app/orders/` contains only this file plus the `pay/`
// subdirectory, and by confirming `/orders/pay`, `/orders/pay/success`, and
// `/orders/pay/fail` still appear as their own entries in `next build`'s
// route table.
//
// Checked node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md
// and .../01-app/02-guides/redirecting.md for this Next.js version's
// convention: `redirect()` from `next/navigation`, called in a Server
// Component, is still the documented way to redirect before render (as
// opposed to `next.config.ts` `redirects()` or `NextResponse.redirect` in
// proxy - both out of scope here per the task, and both suited to
// pattern/condition-based redirects at the edge rather than a single static
// route retirement like this one).
//
// All query parameters are forwarded verbatim - in particular `justOrdered`,
// which src/app/cart/page.tsx and the buy-now flow in
// src/app/products/[id]/page.tsx set after a fresh order so the destination
// can show the "주문이 완료되었습니다" notice (now rendered by /mypage/orders
// itself, preserving what this page used to do).
export default async function OrdersRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
    } else {
      query.append(key, value);
    }
  }
  const queryString = query.toString();
  redirect(`/mypage/orders${queryString ? `?${queryString}` : ""}`);
}
