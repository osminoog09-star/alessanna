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
import { hasStaffRole, isPrivilegedAdminRole, isWorkerOnlyView, normalizeStaffMember } from "../lib/roles";
import { isValidStaffLoginPhoneDigits } from "../lib/staffLoginPhone";
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
  /** No staff session: reception desk mode (calendar + bookings only). */
  isReceptionMode: boolean;
  canManage: boolean;
  /** Admin or owner: full CRM control + role preview. */
  isPrivilegedAdmin: boolean;
  /** True when real (non-preview) role is worker-only. */
  isWorkerOnly: boolean;
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

function staffTableRowToMember(raw: Record<string, unknown>): StaffMember {
  return normalizeStaffMember({
    id: String(raw.id),
    name: String(raw.name ?? ""),
    phone: raw.phone != null ? String(raw.phone) : null,
    is_active: raw.is_active,
    role: raw.role ?? raw.roles,
  } as StaffMember);
}

/**
 * Legacy: `verify_staff_phone` may return a staff row as JSON (object with `id`).
 * If RPC returns only `true`, the app loads the row from `staff` separately.
 */
function parseStaffFromRpcData(data: unknown): StaffMember | null {
  if (data == null || data === false || data === true) return null;

  if (typeof data === "string") {
    const s = data.trim();
    if (!s || s === "null" || s === "false") return null;
    try {
      return parseStaffFromRpcData(JSON.parse(s) as unknown);
    } catch {
      return null;
    }
  }

  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && !Array.isArray(first) && "id" in first) {
      return staffTableRowToMember(first as Record<string, unknown>);
    }
    return null;
  }

  if (typeof data === "object" && data !== null && "id" in data) {
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
    if (!cleanPhone) {
      return { ok: false, errorKey: "auth.error.phoneRequired" };
    }
    if (!isValidStaffLoginPhoneDigits(cleanPhone)) {
      return { ok: false, errorKey: "login.phoneInvalidLength" };
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("verify_staff_phone", {
      phone_input: cleanPhone,
    });

    if (rpcError) {
      console.error(rpcError);
      return { ok: false, errorKey: "auth.error.rpcFailed", message: rpcError.message };
    }

    const rpcSaysOk =
      rpcData === true ||
      rpcData === "true" ||
      (typeof rpcData === "string" && rpcData.trim().toLowerCase() === "true");

    let member: StaffMember | null = null;

    if (rpcSaysOk) {
      const { data: user, error } = await supabase
        .from("staff")
        .select("*")
        .eq("phone", cleanPhone)
        .eq("is_active", true)
        .maybeSingle();

      console.log("Clean phone:", cleanPhone);
      console.log("Fetched user:", user);
      console.log("Fetch error:", error);

      if (error) {
        console.error(error);
      }
      if (user && typeof user === "object" && user !== null && "id" in user) {
        member = staffTableRowToMember(user as Record<string, unknown>);
      }
    } else {
      member = parseStaffFromRpcData(rpcData);
    }

    if (!member) {
      return { ok: false, errorKey: "auth.error.accessDenied", displayError: "Доступ запрещён" };
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(member));
    setStaffMember(member);
    return { ok: true };
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
      isReceptionMode: staffMember == null,
      canManage:
        hasStaffRole(staffMember, "owner") ||
        hasStaffRole(staffMember, "admin") ||
        hasStaffRole(staffMember, "manager"),
      isPrivilegedAdmin: isPrivilegedAdminRole(staffMember?.roles),
      isWorkerOnly: isWorkerOnlyView(staffMember?.roles),
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
