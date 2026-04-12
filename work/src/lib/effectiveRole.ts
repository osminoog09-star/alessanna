import type { Role, StaffMember, StaffRole } from "../types/database";
import { normalizeRoles } from "./roles";

/** Highest privilege in the array for preview baseline. */
export function primaryRoleFromStaff(member: Pick<StaffMember, "roles"> | null | undefined): Role {
  if (!member?.roles?.length) return "staff";
  const r = normalizeRoles(member.roles);
  if (r.includes("admin")) return "admin";
  if (r.includes("manager")) return "manager";
  return "staff";
}

/**
 * Effective CRM role: optional admin preview overrides the real primary role.
 * `user` is the logged-in staff member; `previewRole` is only set by admins in UI.
 */
export function getEffectiveRole(
  user: StaffMember | null,
  previewRole: Role | null
): Role | null {
  if (!user) return null;
  return previewRole ?? primaryRoleFromStaff(user);
}

export function effectiveCanManage(effective: Role | null): boolean {
  return effective === "admin" || effective === "manager";
}

export function effectiveIsAdmin(effective: Role | null): boolean {
  return effective === "admin";
}

export function effectiveIsStaffOnly(effective: Role | null): boolean {
  return effective === "staff";
}

/** True if normalized roles include worker capability (staff, or manager with implicit staff). */
export function effectiveCanWorkCalendar(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return r.includes("staff") || r.includes("manager") || r.includes("admin");
}
