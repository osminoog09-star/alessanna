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
import { hasStaffRole, isWorkerOnlyView, normalizeStaffMember } from "../lib/roles";
import type { StaffMember } from "../types/database";

const STORAGE_KEY = "alessanna_crm_staff";
const DEVICE_TOKEN_KEY = "alessanna_crm_device_token";

/**
 * Результат login. Кроме привычного { ok: true } теперь может быть состояние
 * `requires_pin` — фронт показывает поле PIN и повторно вызывает login(phone, pin).
 */
export type LoginResult =
  | { ok: true; mode?: string }
  | { ok: false; status: "requires_pin"; staffName?: string }
  | { ok: false; status: "invalid_pin" }
  | { ok: false; status: "pin_locked"; lockedUntil?: string }
  | { ok: false; status: "access_denied" }
  | { ok: false; errorKey?: string; message?: string; displayError?: string };

export type LoginInput = {
  phone: string;
  pin?: string;
  trustThisDevice?: boolean;
  deviceLabel?: string;
};

/** Результат входа по invite-ссылке (RPC staff_consume_invite). */
export type ConsumeInviteResult =
  | { ok: true; mode?: string }
  | { ok: false; status: "invalid_token" | "revoked" | "expired" | "used_up" | "staff_inactive" }
  | { ok: false; errorKey?: string; message?: string; displayError?: string };

type AuthState = {
  staffMember: StaffMember | null;
  loading: boolean;
  login: (input: LoginInput | string) => Promise<LoginResult>;
  /** Залогиниться по одноразовому токену из invite-ссылки. Без PIN/телефона.
   * Сразу же сохраняет device_token, так что устройство автоматически
   * становится доверенным. */
  consumeInvite: (token: string) => Promise<ConsumeInviteResult>;
  logout: () => void;
  /** Удалить device_token с этого устройства (без revoke в БД). */
  forgetThisDevice: () => void;
  /** Есть ли локально сохранённый device_token. */
  hasDeviceToken: boolean;
  canManage: boolean;
  isAdmin: boolean;
  /** True when real (non-preview) role is worker-only. */
  isWorkerOnly: boolean;
  /** True when the session is a shared salon reception (no staff logged in yet). Currently always false — reception mode is not implemented. Kept here so `AppTopBar`/`StaffLoginModal` can read a defined flag instead of `undefined`. */
  isReceptionMode: boolean;
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
  } as unknown as StaffMember);
}

function readDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeDeviceToken(token: string | null) {
  try {
    if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
    else localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* swallow */
  }
}

function summarizeUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  // Не пишем весь UA — секретов нет, но без необходимости тащить fingerprint.
  // Ограничим длиной, чтобы не раздувать БД.
  return String(navigator.userAgent || "").slice(0, 240);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staffMember, setStaffMember] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasDeviceToken, setHasDeviceToken] = useState(false);

  useEffect(() => {
    setStaffMember(parseStored());
    setHasDeviceToken(Boolean(readDeviceToken()));
    setLoading(false);
  }, []);

  const login = useCallback(async (input: LoginInput | string): Promise<LoginResult> => {
    const normalized: LoginInput = typeof input === "string" ? { phone: input } : input;

    if (!isSupabaseConfigured()) {
      return { ok: false, errorKey: "auth.error.notConfigured" };
    }
    const cleanPhone = normalized.phone.replace(/\D/g, "");
    if (!cleanPhone) {
      return { ok: false, errorKey: "auth.error.phoneRequired" };
    }

    const deviceToken = readDeviceToken();

    const { data, error } = await supabase.rpc("staff_login", {
      phone_input: cleanPhone,
      pin_input: normalized.pin ?? null,
      device_token: deviceToken,
      trust_this_device: Boolean(normalized.trustThisDevice),
      device_label: normalized.deviceLabel ?? null,
      user_agent_input: summarizeUserAgent(),
    });

    if (error) {
      // Fallback на старый RPC для случая если миграция 041 ещё не применена
      // на каком-то окружении (dev/staging). На проде после деплоя его можно
      // удалить через несколько релизов.
      if (/staff_login.*does not exist/i.test(error.message || "")) {
        const legacy = await supabase.rpc("verify_staff_phone", { phone_input: cleanPhone });
        if (legacy.error) {
          return { ok: false, errorKey: "auth.error.rpcFailed", message: legacy.error.message };
        }
        const legacyRow = legacy.data && typeof legacy.data === "object" && "id" in legacy.data
          ? staffTableRowToMember(legacy.data as Record<string, unknown>)
          : null;
        if (!legacyRow) return { ok: false, status: "access_denied" };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyRow));
        setStaffMember(legacyRow);
        return { ok: true, mode: "legacy_verify_staff_phone" };
      }
      console.error(error);
      return { ok: false, errorKey: "auth.error.rpcFailed", message: error.message };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const status = String(payload.status ?? "");

    if (status === "requires_pin") {
      return {
        ok: false,
        status: "requires_pin",
        staffName: typeof payload.staff_name === "string" ? payload.staff_name : undefined,
      };
    }
    if (status === "invalid_pin") return { ok: false, status: "invalid_pin" };
    if (status === "pin_locked") {
      return {
        ok: false,
        status: "pin_locked",
        lockedUntil: typeof payload.locked_until === "string" ? payload.locked_until : undefined,
      };
    }
    if (status === "access_denied") return { ok: false, status: "access_denied" };

    if (status !== "ok") {
      return { ok: false, errorKey: "auth.error.accessDenied" };
    }

    const staffRaw = payload.staff;
    if (!staffRaw || typeof staffRaw !== "object") {
      return { ok: false, errorKey: "auth.error.accessDenied" };
    }
    const row = staffTableRowToMember(staffRaw as Record<string, unknown>);

    if (typeof payload.new_device_token === "string" && payload.new_device_token) {
      writeDeviceToken(payload.new_device_token);
      setHasDeviceToken(true);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
    setStaffMember(row);
    return { ok: true, mode: typeof payload.mode === "string" ? payload.mode : undefined };
  }, []);

  const consumeInvite = useCallback(async (token: string): Promise<ConsumeInviteResult> => {
    if (!isSupabaseConfigured()) {
      return { ok: false, errorKey: "auth.error.notConfigured" };
    }
    if (!token || token.length < 8) {
      return { ok: false, status: "invalid_token" };
    }
    const { data, error } = await supabase.rpc("staff_consume_invite", {
      token_input: token,
      device_label: "Invite link",
      user_agent_input: summarizeUserAgent(),
    });
    if (error) {
      return { ok: false, errorKey: "auth.error.rpcFailed", message: error.message };
    }
    const payload = (data ?? {}) as Record<string, unknown>;
    const status = String(payload.status ?? "");
    if (status === "invalid_token" || status === "revoked"
        || status === "expired" || status === "used_up"
        || status === "staff_inactive") {
      return { ok: false, status };
    }
    if (status !== "ok") {
      return { ok: false, errorKey: "auth.error.accessDenied" };
    }
    const staffRaw = payload.staff;
    if (!staffRaw || typeof staffRaw !== "object") {
      return { ok: false, errorKey: "auth.error.accessDenied" };
    }
    const row = staffTableRowToMember(staffRaw as Record<string, unknown>);
    if (typeof payload.new_device_token === "string" && payload.new_device_token) {
      writeDeviceToken(payload.new_device_token);
      setHasDeviceToken(true);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
    setStaffMember(row);
    return { ok: true, mode: typeof payload.mode === "string" ? payload.mode : undefined };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    // Внимание: device_token НЕ удаляем — это смысл «доверенного устройства».
    // Чтобы устройство «забыть», есть отдельный forgetThisDevice().
    setStaffMember(null);
  }, []);

  const forgetThisDevice = useCallback(() => {
    writeDeviceToken(null);
    setHasDeviceToken(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      staffMember,
      loading,
      login,
      consumeInvite,
      logout,
      forgetThisDevice,
      hasDeviceToken,
      canManage: hasStaffRole(staffMember, "admin") || hasStaffRole(staffMember, "manager"),
      isAdmin: hasStaffRole(staffMember, "admin"),
      isWorkerOnly: isWorkerOnlyView(staffMember?.roles),
      isReceptionMode: false,
    }),
    [staffMember, loading, login, consumeInvite, logout, forgetThisDevice, hasDeviceToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
