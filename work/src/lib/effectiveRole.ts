import type { Role, StaffMember, StaffRole } from "../types/database";
import { normalizeRoles } from "./roles";

export function primaryRoleFromStaff(member: Pick<StaffMember, "roles"> | null | undefined): Role {
  if (!member?.roles?.length) return "worker";
  const r = normalizeRoles(member.roles);
  if (r.includes("owner")) return "owner";
  if (r.includes("admin")) return "admin";
  if (r.includes("manager")) return "manager";
  return "worker";
}

export function getEffectiveRole(
  user: StaffMember | null,
  previewRole: Role | null
): Role | null {
  if (!user) return null;
  return previewRole ?? primaryRoleFromStaff(user);
}

export function effectiveCanManage(effective: Role | null): boolean {
  return effective === "owner" || effective === "admin" || effective === "manager";
}

/** True for admin or owner (e.g. role preview); not for managers. */
export function effectiveIsAdmin(effective: Role | null): boolean {
  return effective === "admin" || effective === "owner";
}

export function effectiveIsWorkerOnly(effective: Role | null): boolean {
  return effective === "worker";
}

export function effectiveCanWorkCalendar(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return (
    r.includes("worker") || r.includes("manager") || r.includes("admin") || r.includes("owner")
  );
}
