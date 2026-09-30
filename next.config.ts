import type { NextConfig } from "next";

// Security response headers.
//
// API shape verified against the bundled docs before writing this (this Next
// version has breaking changes vs. training data, per AGENTS.md):
//   node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md
//   node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
// `headers()` is an async function returning `{ source, headers: [{ key, value }] }[]`,
// same shape as legacy Next.js. `source: "/(.*)"` applies to every route.

const isProduction = process.env.NODE_ENV === "production";

// --- Content-Security-Policy -------------------------------------------
//
// This app loads the Toss Payments SDK (@tosspayments/tosspayments-sdk) for
// the checkout flow at /orders/pay. Inspecting the installed package
// (node_modules/@tosspayments/tosspayments-sdk/dist/index.esm.js) shows that
// the npm package itself does NOT embed the payment UI: `loadTossPayments()`
// just injects a single <script src="https://js.tosspayments.com/v2/standard">
// tag (see `SCRIPT_URL` in that file) and calls the global it exposes. That
// remote script is fetched fresh from Toss's CDN at runtime and is not
// present anywhere in this repository, so its actual behavior (which
// additional script/frame/connect origins it in turn loads for card
// input, 3-D Secure/ARS popups, bank-app deep links, etc.) cannot be
// determined by reading the package.
//
// The rest of the origin list is therefore taken from Toss's own published
// requirements rather than guessed at:
//   https://docs.tosspayments.com/reference/using-api/security
// which lists the domains a merchant must allow through a firewall or proxy
// for the payment window to work:
//   api.tosspayments.com, event.tosspayments.com, pages.tosspayments.com,
//   static.toss.im, polyfill-fe.toss.im, assets-fe.toss.im
// plus js.tosspayments.com for the loader confirmed above. That page states
// firewall/port requirements and does NOT break the list down per CSP
// directive, so each origin below is allowed in every directive it could
// plausibly be needed in (script/frame/connect/img) rather than being
// guessed into exactly one.
//
// This still ships as `Content-Security-Policy-Report-Only`. Toss documents
// which hosts must be reachable, not which CSP directive each is fetched
// under, and the payment window is remote code that can change - so a wrong
// `frame-src`/`connect-src` guess would break checkout with no visible error
// for the buyer. Report-Only lets browsers evaluate and report violations
// without blocking anything. Run one real Toss payment, read the violation
// reports, then switch this key to `Content-Security-Policy`. That could not
// be done here (no Toss credentials or browser session available).
//
// - `api.tosspayments.com` is called from the server
//   (src/app/api/payments/toss/*/route.ts), where CSP does not apply, but it
//   is in Toss's browser-reachable list too so it is kept in `connect-src`.
// - The payment window itself runs in a cross-origin frame and enforces its
//   own CSP; ours only governs which origins this page may frame.
// - `img-src` allows `https:` broadly (in addition to `'self'` and `data:`)
//   because listing photos are served from an operator-configured
//   `S3_PUBLIC_BASE_URL` (Cloudflare R2 or any CDN, see README) that is not
//   knowable at config-authoring time and can differ per deployment.
// - `style-src`/`script-src` allow `'unsafe-inline'` because Tailwind v4 and
//   Next's inline runtime bootstrap script both rely on it; adopting nonces
//   would require dynamic rendering everywhere (see the CSP guide above) and
//   is out of scope for this pass.
// - `'unsafe-eval'` is added only in development, matching the documented
//   guidance that React's dev-mode error reconstruction needs it and that
//   neither React nor Next.js need it in production.
// Every origin Toss documents as required, in one place so the directives
// below cannot drift apart from each other.
// Wildcarded per Toss-operated domain rather than enumerated host by host.
//
// The enumerated list was tried first, built from Toss's own published
// requirements (https://docs.tosspayments.com/reference/using-api/security:
// api / event / pages .tosspayments.com, static / polyfill-fe / assets-fe
// .toss.im) plus js.tosspayments.com for the SDK loader. Running one real
// test payment end to end then produced report-only violations for three
// hosts that list does not mention:
//
//   log.tosspayments.com                     (connect-src, on SDK load)
//   apigw-sandbox.tosspayments.com           (connect-src, opening checkout)
//   payment-gateway-sandbox.tosspayments.com (frame-src, THE PAYMENT WINDOW)
//
// The third one is the checkout iframe itself: an enforcing policy built
// from the documented list would have blocked the payment window outright,
// and the buyer would have seen nothing explaining why. Two of the three are
// also `-sandbox` hosts, so live keys will contact yet another set of names
// that cannot be observed until the account goes live.
//
// Enumerating hostnames is therefore a losing game here — each miss is a
// silently broken checkout. A wildcard still constrains loading to domains
// Toss operates, which is the actual security boundary worth enforcing,
// while surviving hostnames that only appear in production.
const TOSS_ORIGINS = ["https://*.tosspayments.com", "https://*.toss.im"].join(" ");

const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TOSS_ORIGINS}${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${TOSS_ORIGINS}`,
  `frame-src 'self' ${TOSS_ORIGINS}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
];
const contentSecurityPolicy = cspDirectives.join("; ");

const securityHeaders = [
  // HSTS only makes sense once the app is actually served over HTTPS in
  // production (Render terminates TLS in front of it); sending it in local
  // dev over plain http:// would just be ignored by browsers but there's no
  // reason to emit it there at all.
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  // Superseded by CSP's `frame-ancestors 'none'` above in modern browsers,
  // but kept for older browsers that don't support that CSP directive -
  // clickjacking on top of the payment flow is worth the belt-and-suspenders.
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Strict-but-not-silent: same-origin navigations still get the full path,
  // cross-origin ones only get the origin, and nothing is sent over plain
  // http. Avoids leaking order/listing IDs in the URL path to third parties
  // (e.g. via an outbound link on a product page) while not breaking
  // same-origin analytics/referrer checks.
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // Deny every browser feature this app doesn't use. Left off the deny list:
  // `payment`, since the Toss Payments checkout iframe needs the Payment
  // Request-adjacent APIs some card/bank flows rely on.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicy,
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
