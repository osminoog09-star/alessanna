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
import { hasStaffRole, isStaffOnlyView, normalizeEmployeeRow, normalizeRoles } from "../lib/roles";
import type { EmployeeRow } from "../types/database";

const STORAGE_KEY = "alessanna_crm_staff";

export type LoginResult =
  | { ok: true }
  | { ok: false; errorKey?: string; message?: string; displayError?: string };

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

function rpcBooleanSuccess(data: unknown): boolean {
  return (
    data === true ||
    data === "true" ||
    (Array.isArray(data) && data[0] === true)
  );
}

function normalizePhoneDigits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}

/** Map `staff` table row (phone, name, role, is_active, …) to app `EmployeeRow`. */
function staffTableRowToEmployee(raw: Record<string, unknown>): EmployeeRow {
  const roleField = raw.role ?? raw.roles;
  const roles = normalizeRoles(roleField);

  return normalizeEmployeeRow({
    id: Number(raw.id),
    name: String(raw.name ?? ""),
    phone: raw.phone != null ? String(raw.phone) : null,
    email: raw.email != null ? String(raw.email) : null,
    active: Boolean(raw.is_active ?? raw.active ?? true),
    slug: raw.slug != null ? String(raw.slug) : null,
    roles,
    payroll_type: raw.payroll_type === "fixed" ? "fixed" : "percent",
    commission: Number(raw.commission ?? 0),
    fixed_salary: Number(raw.fixed_salary ?? 0),
  } as EmployeeRow);
}

async function fetchEmployeeByCleanPhone(cleanPhone: string): Promise<EmployeeRow | null> {
  if (!cleanPhone) return null;

  const normalize = (p: string) => p.replace(/\D/g, "");

  const { data, error } = await supabase.from("staff").select("*").eq("is_active", true);

  console.log("FETCH STAFF RESULT:", data);
  console.log("FETCH STAFF ERROR:", error);

  if (error || !data?.length) return null;

  const rows = data as Record<string, unknown>[];
  const found = rows.find((e) => normalize(String(e.phone ?? "")).endsWith(cleanPhone));

  if (!found) return null;

  return staffTableRowToEmployee(found);
}

/** Parse employee row from various RPC / PostgREST shapes. */
function parseEmployeeFromRpcData(data: unknown): EmployeeRow | null {
  if (data == null || data === false || data === "false") return null;

  if (typeof data === "string") {
    if (data === "true" || data.length === 0) return null;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "id" in parsed) {
        return normalizeEmployeeRow(parsed as EmployeeRow);
      }
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && "id" in parsed[0]) {
        return normalizeEmployeeRow(parsed[0] as EmployeeRow);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && !Array.isArray(first) && "id" in first) {
      return normalizeEmployeeRow(first as EmployeeRow);
    }
    return null;
  }

  if (typeof data === "object" && "id" in data) {
    return normalizeEmployeeRow(data as EmployeeRow);
  }

  return null;
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

    const cleanPhone = phone.replace(/\D/g, "");

    const { data, error } = await supabase.rpc("verify_staff_phone", {
      phone_input: cleanPhone,
    });

    console.log("RPC raw result:", data);

    if (error) {
      console.error(error);
      return { ok: false, displayError: "Ошибка сервера" };
    }

    let row = parseEmployeeFromRpcData(data);

    const isValid =
      rpcBooleanSuccess(data) ||
      row != null ||
      (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null && "id" in data[0]);

    console.log("RPC isValid (expanded):", isValid);

    if (rpcBooleanSuccess(data) && !row && cleanPhone.length > 0) {
      const fromStaff = await fetchEmployeeByCleanPhone(cleanPhone);
      if (fromStaff) {
        row = fromStaff;
      }
    }

    if (row) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
      setEmployee(row);
      return { ok: true };
    }

    return { ok: false, displayError: "Доступ запрещён" };
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
