import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

// Render polls `healthCheckPath` (see render.yaml) continuously, so this
// must stay cheap — a single `SELECT 1`, never a table scan or a count.
//
// GET Route Handlers already default to dynamic rendering (not statically
// cached) since Next 15.0.0-RC — confirmed in the version history table of
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
// ("The default caching for GET handlers was changed from static to
// dynamic"). This repo does not enable Cache Components (no `cacheComponents`
// flag in next.config.ts), so the legacy `dynamic` segment config is still
// honored per node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md.
// `force-dynamic` is set explicitly anyway so this endpoint can never start
// returning a stale cached body if that default ever changes, or if a CDN in
// front of Render decides to cache a 200 route handler response.
export const dynamic = "force-dynamic";

// Unauthenticated by necessity (Render's health checker cannot log in), so
// this must leak nothing back to the caller: no error message, no table or
// schema name, no Postgres version, no row counts. Every failure collapses
// to the same minimal 503 body; the real cause only ever goes to
// console.error, which lands in server logs, not the response — same
// "never surface raw error detail to the client" rule as error.tsx.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("HEALTH_CHECK_DB_UNREACHABLE", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
