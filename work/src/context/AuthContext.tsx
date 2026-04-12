import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { hasStaffRole, isStaffOnlyView, normalizeEmployeeRow } from "../lib/roles";
import type { EmployeeRow } from "../types/database";

const STORAGE_KEY = "alessanna_crm_staff";

export type LoginResult =
  | { ok: true }
  | { ok: false; errorKey: string; message?: string };

type AuthState = {
  employee: EmployeeRow | null;
  loading: boolean;
  login: (phone: string) => Promise<LoginResult>;
  logout: () => void;
  canManage: boolean;
  isAdmin: boolean;
  isStaffOnly: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function parseStored(): EmployeeRow | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeEmployeeRow(JSON.parse(raw) as EmployeeRow);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEmployee(parseStored());
    setLoading(false);
  }, []);

  const login = useCallback(async (phone: string): Promise<LoginResult> => {
    if (!isSupabaseConfigured()) {
      return { ok: false, errorKey: "auth.error.notConfigured" };
    }
    const digits = phone.replace(/\D/g, "");
    if (!digits) return { ok: false, errorKey: "auth.error.phoneRequired" };

    const { data, error } = await supabase.rpc("verify_staff_phone", {
      phone_input: digits,
    });

    if (error) {
      if (import.meta.env.DEV) console.error(error);
      return { ok: false, errorKey: "auth.error.rpcFailed", message: error.message };
    }

    let row: EmployeeRow | null = null;
    if (typeof data === "string" && data.length > 0) {
      try {
        row = normalizeEmployeeRow(JSON.parse(data) as EmployeeRow);
      } catch {
        row = null;
      }
    } else if (data && typeof data === "object" && "id" in data) {
      row = normalizeEmployeeRow(data as unknown as EmployeeRow);
    }

    if (!row) {
      return { ok: false, errorKey: "auth.error.denied" };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
    setEmployee(row);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEmployee(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      employee,
      loading,
      login,
      logout,
      canManage: hasStaffRole(employee, "admin") || hasStaffRole(employee, "manager"),
      isAdmin: hasStaffRole(employee, "admin"),
      isStaffOnly: isStaffOnlyView(employee?.roles),
    }),
    [employee, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
