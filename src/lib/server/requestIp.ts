// Render (and most PaaS reverse proxies) sit in front of this app and forward
// the original client address via `x-forwarded-for`. That header is a
// comma-separated hop list; every entry except the ones appended by trusted
// proxies between the client and this process can be set by the client or by
// any untrusted intermediary.
//
// TRUSTED_PROXY_HOPS (env, positive integer, default 1, parsed once at module
// load) says how many trusted proxies sit between the client and this
// process. With Render alone in front (today's default deployment), that's 1
// — XFF has exactly one hop appended (the client's address as seen by
// Render's edge), so the *last* entry is the one to trust. If a CDN such as
// Cloudflare is added in front of Render, XFF gains one more hop on the left
// and TRUSTED_PROXY_HOPS must become 2, so this reads the client's address
// instead of Cloudflare's own egress address (which, left untreated, would
// otherwise be the same for every visitor and collapse every caller into one
// shared rate-limit bucket).
//
// SECURITY NOTE (a): with TRUSTED_PROXY_HOPS=2 (or higher), the hop this
// function trusts is only correct if every request reaching this process
// really did pass through exactly that many trusted proxies. If the origin
// (Render) can be reached directly, bypassing the CDN, an attacker can send
// an arbitrary `x-forwarded-for` and land whatever value they like at the
// trusted position — i.e. choose their own rate-limit bucket key, either to
// dodge a block or to frame another IP with one. That lets an attacker steer
// only their *own* bucket; it cannot recreate the global-lockout bug this
// file fixes (everyone sharing one bucket), but it is a real residual gap.
// The actual fix is infrastructural: restrict origin (Render) ingress to the
// CDN's published IP ranges so a direct request can never reach this process.
// Until that's in place, treat the bypass above as a known limitation.
//
// SECURITY NOTE (b): because of (a), the value this function returns must be
// used only as a rate-limit bucket key — never for audit logging, "who did
// this" attribution, or any other purpose that assumes it is trustworthy
// identity information.
const rawTrustedProxyHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
const TRUSTED_PROXY_HOPS =
  Number.isFinite(rawTrustedProxyHops) && rawTrustedProxyHops > 0 ? rawTrustedProxyHops : 1;

/**
 * Returns the client's IP address for rate-limit bucketing, or `null` when it
 * can't be determined reliably — no forwarding headers at all, or fewer XFF
 * hops than TRUSTED_PROXY_HOPS expects (see the module comment; that means a
 * proxy was bypassed or TRUSTED_PROXY_HOPS is misconfigured, so no hop is
 * trustworthy). Callers must treat `null` as "skip the IP axis of rate
 * limiting" — never interpolate it into a string key (e.g. `` `foo:${ip}` ``
 * when ip is null yields the literal string `"foo:null"`, which is exactly
 * the kind of shared bucket this change exists to avoid).
 */
export function getClientIp(headers: Headers | Record<string, unknown> | null | undefined): string | null {
  const forwardedFor = readHeader(headers, "x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    // Fewer hops than the configured trusted-proxy depth means the request
    // didn't pass through as many proxies as expected — never fall back to
    // guessing at an arbitrary hop.
    if (hops.length < TRUSTED_PROXY_HOPS) return null;
    const trustedHop = hops[hops.length - TRUSTED_PROXY_HOPS];
    return trustedHop || null;
  }

  const realIp = readHeader(headers, "x-real-ip");
  if (realIp) return realIp.trim();

  // No proxy header at all (e.g. local dev, or a direct request that reached
  // this process without going through the expected proxy chain) — there is
  // nothing trustworthy to bucket on.
  return null;
}

function readHeader(
  headers: Headers | Record<string, unknown> | null | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const value = (headers as Record<string, unknown>)[name];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}
