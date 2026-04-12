import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Role } from "../types/database";
import {
  effectiveCanManage,
  effectiveIsAdmin,
  effectiveIsWorkerOnly,
  getEffectiveRole,
} from "../lib/effectiveRole";
import { useAuth } from "./AuthContext";

type Ctx = {
  previewRole: Role | null;
  setPreviewRole: (r: Role | null) => void;
  effectiveRole: Role | null;
  /** No logged-in staff (reception desk). */
  isReceptionMode: boolean;
  canManage: boolean;
  /** Effective preview role is admin or owner (not manager). */
  isAdminEffective: boolean;
  /** Effective user is line worker only (own appointments / locked calendar). */
  isWorkerOnlyEffective: boolean;
};

const EffectiveRoleContext = createContext<Ctx | null>(null);

export function EffectiveRoleProvider({ children }: { children: ReactNode }) {
  const { staffMember } = useAuth();
  const [previewRole, setPreviewRoleState] = useState<Role | null>(null);

  const setPreviewRole = useCallback((r: Role | null) => {
    setPreviewRoleState(r);
  }, []);

  useEffect(() => {
    if (!staffMember) setPreviewRoleState(null);
  }, [staffMember]);

  const effectiveRole = useMemo(
    () => getEffectiveRole(staffMember, previewRole),
    [staffMember, previewRole]
  );

  const isReceptionMode = staffMember == null;

  const value = useMemo<Ctx>(
    () => ({
      previewRole,
      setPreviewRole,
      effectiveRole,
      isReceptionMode,
      canManage: effectiveCanManage(effectiveRole),
      isAdminEffective: effectiveIsAdmin(effectiveRole),
      isWorkerOnlyEffective: effectiveIsWorkerOnly(effectiveRole),
    }),
    [previewRole, setPreviewRole, effectiveRole, isReceptionMode]
  );

  return <EffectiveRoleContext.Provider value={value}>{children}</EffectiveRoleContext.Provider>;
}

export function useEffectiveRole(): Ctx {
  const ctx = useContext(EffectiveRoleContext);
  if (!ctx) throw new Error("useEffectiveRole outside EffectiveRoleProvider");
  return ctx;
}
