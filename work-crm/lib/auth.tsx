"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, getStoredToken, setStoredToken } from "./api";

export type CrmUser = {
  id: number;
  email: string;
  role: string;
  employeeId: number | null;
  name?: string;
};

type AuthState = {
  user: CrmUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setSession: (accessToken: string, user: CrmUser) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CrmUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await apiFetch("/api/auth/me");
    const j = (await r.json()) as { user: CrmUser | null };
    setUser(j.user ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setStoredToken(null);
    setUser(null);
  }, []);

  const setSession = useCallback((accessToken: string, u: CrmUser) => {
    setStoredToken(accessToken);
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, logout, setSession }),
    [user, loading, refresh, logout, setSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function useIsManager(): boolean {
  const { user } = useAuth();
  return !!user && (user.role === "admin" || user.role === "manager");
}
