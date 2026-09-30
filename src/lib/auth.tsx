"use client";

import { createContext, useContext, type ReactNode } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (id: string, password: string) => Promise<{
    ok: boolean;
    message?: string;
    role?: User["role"];
  }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const sessionUser = session?.user;
  const user: User | null = sessionUser
    ? {
        id: sessionUser.id,
        businessName: sessionUser.name ?? "회원",
        ownerName: sessionUser.name ?? "회원",
        phone: "",
        role: sessionUser.role,
        sellerId: sessionUser.sellerId,
      }
    : null;

  const login: AuthContextValue["login"] = async (id, password) => {
    const result = await signIn("credentials", {
      loginId: id,
      password,
      redirect: false,
    });

    if (!result || result.error) {
      return { ok: false, message: "아이디 또는 비밀번호를 확인해 주세요." };
    }
    const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
    const currentSession = (await sessionResponse.json()) as { user?: { role?: User["role"] } };
    return { ok: true, role: currentSession.user?.role };
  };

  const logout = () => {
    void signOut({ redirect: false });
  };

  return (
    <AuthContext.Provider value={{ user, loading: status === "loading", login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
