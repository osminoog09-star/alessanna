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
import { hasStaffRole, isStaffOnlyView, normalizeRoles, normalizeStaffMember } from "../lib/roles";
import type { StaffMember } from "../types/database";

const STORAGE_KEY = "alessanna_crm_staff";

export type LoginResult =
  | { ok: true }
  | { ok: false; errorKey?: string; message?: string; displayError?: string };

type AuthState = {
  staffMember: StaffMember | null;
  loading: boolean;
  login: (phone: string) => Promise<LoginResult>;
  logout: () => void;
  /** Real privileges (ignores role preview). */
  canManage: boolean;
  isAdmin: boolean;
  isStaffOnly: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

function parseStored(): StaffMember | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeStaffMember(JSON.parse(raw) as StaffMember);
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

function staffTableRowToMember(raw: Record<string, unknown>): StaffMember {
  const roleField = raw.role ?? raw.roles;
  const roles = normalizeRoles(roleField);
  return normalizeStaffMember({
    id: String(raw.id),
    name: String(raw.name ?? ""),
    phone: raw.phone != null ? String(raw.phone) : null,
    active: Boolean(raw.is_active ?? raw.active ?? true),
    roles,
  });
}

async function fetchStaffByCleanPhone(cleanPhone: string): Promise<StaffMember | null> {
  if (!cleanPhone) return null;

  const normalize = (p: string) => p.replace(/\D/g, "");

  const { data, error } = await supabase.from("staff").select("*").eq("is_active", true);

  if (error || !data?.length) return null;

  const rows = data as Record<string, unknown>[];
  const found = rows.find((e) => normalize(String(e.phone ?? "")).endsWith(cleanPhone));

  if (!found) return null;

  return staffTableRowToMember(found);
}

function parseStaffFromRpcData(data: unknown): StaffMember | null {
  if (data == null || data === false || data === "false") return null;

  if (typeof data === "string") {
    if (data === "true" || data.length === 0) return null;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "id" in parsed) {
        return normalizeStaffMember(parsed as StaffMember);
      }
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object" && "id" in parsed[0]) {
        return normalizeStaffMember(parsed[0] as StaffMember);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && !Array.isArray(first) && "id" in first) {
      return normalizeStaffMember(first as StaffMember);
    }
    return null;
  }

  if (typeof data === "object" && "id" in data) {
    return staffTableRowToMember(data as Record<string, unknown>);
  }

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staffMember, setStaffMember] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setStaffMember(parseStored());
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

    if (error) {
      console.error(error);
      return { ok: false, displayError: "Ошибка сервера" };
    }

    let row = parseStaffFromRpcData(data);

    const isValid =
      rpcBooleanSuccess(data) ||
      row != null ||
      (Array.isArray(data) &&
        data.length > 0 &&
        typeof data[0] === "object" &&
        data[0] !== null &&
        "id" in data[0]);

    if (!row && cleanPhone.length > 0) {
      const fromStaff = await fetchStaffByCleanPhone(cleanPhone);
      if (fromStaff) row = fromStaff;
    }

    if (row) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
      setStaffMember(row);
      return { ok: true };
    }

    if (!isValid) {
      return { ok: false, displayError: "Доступ запрещён" };
    }

    return { ok: false, displayError: "Доступ запрещён" };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setStaffMember(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      staffMember,
      loading,
      login,
      logout,
      canManage: hasStaffRole(staffMember, "admin") || hasStaffRole(staffMember, "manager"),
      isAdmin: hasStaffRole(staffMember, "admin"),
      isStaffOnly: isStaffOnlyView(staffMember?.roles),
    }),
    [staffMember, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
