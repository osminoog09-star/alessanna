"use client";

import type { ReactNode } from "react";
import { useAuth, useIsManager } from "@/lib/auth";

export function RequireManager({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const isManager = useIsManager();
  if (loading || !user) return null;
  if (!isManager) {
    return <p className="muted">You don&apos;t have access to this section.</p>;
  }
  return <>{children}</>;
}
