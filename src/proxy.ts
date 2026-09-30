import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

type ProtectedRole = "SELLER" | "ADMIN";

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "redirect",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Seller signup is explicitly public; all other seller/admin pages require a role.
  if (pathname === "/seller/signup" || pathname.startsWith("/seller/signup/")) {
    return NextResponse.next();
  }

  // `/reset-password/admin` is the operator screen that mints account-
  // recovery tokens (src/app/reset-password/admin/page.tsx) — it is
  // deliberately not nested under /admin (see that file's comment) but
  // still needs the same proxy coverage as every other admin surface, so it
  // is checked here as its own ADMIN-gated prefix. `/reset-password` and
  // `/reset-password/confirm` (the actual public recovery flow, plus
  // `/find-id`) are untouched by this check and stay public — see the
  // matcher below, which only targets `/reset-password/admin`, not
  // `/reset-password` itself.
  const requiredRole: ProtectedRole | null = pathname.startsWith("/seller")
    ? "SELLER"
    : pathname.startsWith("/admin") || pathname.startsWith("/reset-password/admin")
      ? "ADMIN"
      : null;

  if (!requiredRole) return NextResponse.next();

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return redirectToLogin(request);

  try {
    const secureCookie =
      request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
    const token = await getToken({ req: request, secret, secureCookie });
    if (token?.role !== requiredRole) return redirectToLogin(request);
  } catch {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  // `/reset-password/admin/:path*` widens coverage to the admin recovery
  // screen without matching `/reset-password` or `/reset-password/confirm`
  // (path-to-regexp anchors `/reset-password/admin` to that exact prefix —
  // it does not also match sibling paths like `/reset-password/confirm`,
  // per the "Are anchored to the start of the path" rule in
  // node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
  // `/find-id` is unrelated to this prefix and was never matched.
  matcher: ["/seller/:path*", "/admin/:path*", "/reset-password/admin/:path*"],
};
