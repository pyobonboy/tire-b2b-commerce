import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import { getSession } from "./auth";

export async function requireRole(allowedRoles: readonly Role[]) {
  const session = await getSession();

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    } as const;
  }

  if (!allowedRoles.includes(session.user.role)) {
    return {
      session: null,
      response: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
    } as const;
  }

  return { session, response: null } as const;
}
