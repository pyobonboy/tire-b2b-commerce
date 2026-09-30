import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      sellerId: string | null;
      // Seconds-since-epoch `iat` copied off the JWT so getSession can compare
      // it against User.passwordChangedAt. Optional because a token minted
      // before this existed carries no issue time we can check.
      tokenIssuedAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    sellerId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    sellerId?: string | null;
  }
}
