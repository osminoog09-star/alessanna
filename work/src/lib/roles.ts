import type { Role, ServiceRow, StaffMember, StaffRole, StaffServiceRow } from "../types/database";

export type { Role, StaffRole };

const ALLOWED: readonly StaffRole[] = ["admin", "manager", "staff"];

function mapRoleToken(x: unknown): StaffRole | null {
  if (typeof x !== "string") return null;
  const l = x.toLowerCase().trim();
  if (l === "viewer" || l === "employee") return "staff";
  if (l === "admin" || l === "manager" || l === "staff") return l;
  return null;
}

function attachStaffForManagers(roles: StaffRole[]): StaffRole[] {
  if (roles.includes("manager") && !roles.includes("staff")) {
    return [...roles, "staff"];
  }
  return roles;
}

export function normalizeRoles(raw: unknown): StaffRole[] {
  if (Array.isArray(raw)) {
    const out = raw.map(mapRoleToken).filter((x): x is StaffRole => x != null);
    const uniq = [...new Set(out)];
    return attachStaffForManagers(uniq.length ? uniq : ["staff"]);
  }
  const single = mapRoleToken(raw);
  if (single) return attachStaffForManagers([single]);
  return ["staff"];
}

export function normalizeStaffMember(row: StaffMember | (Record<string, unknown> & { id?: string })): StaffMember {
  const r = row as Record<string, unknown> & { id: string };
  const roles = normalizeRoles(r.roles ?? r.role);
  const rest = { ...r } as Record<string, unknown>;
  delete rest.role;
  delete rest.roles;
  const active = Boolean(r.active ?? r.is_active ?? true);
  return {
    ...(rest as Omit<StaffMember, "roles" | "active">),
    id: String(r.id),
    active,
    roles,
  };
}

export function hasStaffRole(
  member: Pick<StaffMember, "roles"> | null | undefined,
  role: StaffRole
): boolean {
  if (!member?.roles?.length) return false;
  return normalizeRoles(member.roles).includes(role);
}

export function isStaffOnlyView(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return r.includes("staff") && !r.includes("manager") && !r.includes("admin");
}

export function sanitizeRolesForSave(
  edited: StaffRole[],
  editorIsAdmin: boolean,
  storedRoles: StaffRole[] | undefined
): StaffRole[] {
  const norm = normalizeRoles(edited);
  const storedNorm = normalizeRoles(storedRoles);
  if (editorIsAdmin) return attachStaffForManagers(norm.length ? norm : ["staff"]);
  let out = norm.filter((r) => r !== "admin");
  if (storedNorm.includes("admin")) out = [...new Set([...out, "admin"])];
  return attachStaffForManagers(out.length ? out : ["staff"]);
}

/**
 * Active staff for a service: linked in `staff_services`, or no links for that service (all active),
 * or active manager/admin without a link.
 */
export function staffEligibleForService(
  staffList: StaffMember[],
  links: StaffServiceRow[],
  serviceId: number | null
): StaffMember[] {
  const active = staffList.filter((s) => s.active);
  if (serviceId == null) return active;
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return active;
  const ids = new Set(forSvc.map((l) => l.staff_id));
  return active.filter((e) => {
    if (ids.has(e.id)) return true;
    const r = normalizeRoles(e.roles);
    return r.includes("manager") || r.includes("admin");
  });
}

export function staffCanPerformService(
  links: StaffServiceRow[],
  staffId: string,
  serviceId: number,
  staffList?: StaffMember[]
): boolean {
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return true;
  if (forSvc.some((l) => l.staff_id === staffId)) return true;
  const st = staffList?.find((e) => e.id === staffId);
  if (!st?.active) return false;
  const r = normalizeRoles(st.roles);
  return r.includes("manager") || r.includes("admin");
}

export function servicesEligibleForStaff(
  services: ServiceRow[],
  links: StaffServiceRow[],
  staffId: string,
  staffRow?: Pick<StaffMember, "roles" | "active"> | null
): ServiceRow[] {
  const active = services.filter((s) => s.active);
  const forSt = links.filter((l) => l.staff_id === staffId);
  if (forSt.length === 0) return active;
  if (
    staffRow?.active &&
    (hasStaffRole(staffRow, "manager") || hasStaffRole(staffRow, "admin"))
  ) {
    return active;
  }
  const ids = new Set(forSt.map((l) => l.service_id));
  return active.filter((s) => ids.has(s.id));
}
