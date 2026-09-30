"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import LoadingState from "./LoadingState";

type Role = "BUYER" | "SELLER" | "ADMIN";

export default function RequireAuth({
  children,
  allow,
}: {
  children: React.ReactNode;
  allow?: readonly Role[];
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const allowed = Boolean(user && (!allow || (user.role && allow.includes(user.role))));

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace("/login");
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) {
    return <LoadingState />;
  }

  return <>{children}</>;
}
