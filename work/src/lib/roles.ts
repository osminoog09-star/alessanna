import type { Role, ServiceListingRow, StaffMember, StaffRole, StaffServiceRow } from "../types/database";
import { serviceListingIsActive } from "./serviceListing";

export type { Role, StaffRole };

function mapRoleToken(x: unknown): StaffRole | null {
  if (typeof x !== "string") return null;
  const l = x.toLowerCase().trim();
  if (l === "viewer") return null;
  if (l === "employee" || l === "staff") return "worker";
  if (l === "owner" || l === "admin" || l === "manager" || l === "worker") return l;
  return null;
}

/** Managers can also take appointments like line staff. */
function attachWorkerForManagers(roles: StaffRole[]): StaffRole[] {
  if (roles.includes("manager") && !roles.includes("worker")) {
    return [...roles, "worker"];
  }
  return roles;
}

export function normalizeRoles(raw: unknown): StaffRole[] {
  if (Array.isArray(raw)) {
    const out = raw.map(mapRoleToken).filter((x): x is StaffRole => x != null);
    const uniq = [...new Set(out)];
    return attachWorkerForManagers(uniq.length ? uniq : ["worker"]);
  }
  const single = mapRoleToken(raw);
  if (single) return attachWorkerForManagers([single]);
  return ["worker"];
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

/** Admin or owner: full staff/settings control (managers excluded). */
export function isPrivilegedAdminRole(roles: StaffRole[] | undefined | null): boolean {
  const r = normalizeRoles(roles);
  return r.includes("admin") || r.includes("owner");
}

/** Line staff only: worker, not manager/admin/owner (after normalization). */
export function isWorkerOnlyView(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return (
    r.includes("worker") &&
    !r.includes("manager") &&
    !r.includes("admin") &&
    !r.includes("owner")
  );
}

export function sanitizeRolesForSave(
  edited: StaffRole[],
  editorIsPrivilegedAdmin: boolean,
  storedRoles: StaffRole[] | undefined
): StaffRole[] {
  const norm = normalizeRoles(edited);
  const storedNorm = normalizeRoles(storedRoles);
  if (editorIsPrivilegedAdmin) return attachWorkerForManagers(norm.length ? norm : ["worker"]);
  let out = norm.filter((r) => r !== "admin" && r !== "owner");
  if (storedNorm.includes("admin")) out = [...new Set([...out, "admin"])];
  if (storedNorm.includes("owner")) out = [...new Set([...out, "owner"])];
  return attachWorkerForManagers(out.length ? out : ["worker"]);
}

export function staffEligibleForService(
  staffList: StaffMember[],
  links: StaffServiceRow[],
  serviceId: string | null
): StaffMember[] {
  const active = staffList.filter((s) => s.active);
  if (serviceId == null) return active;
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return active;
  const ids = new Set(forSvc.map((l) => l.staff_id));
  return active.filter((e) => {
    if (ids.has(e.id)) return true;
    const r = normalizeRoles(e.roles);
    return r.includes("manager") || r.includes("admin") || r.includes("owner");
  });
}

export function staffCanPerformService(
  links: StaffServiceRow[],
  staffId: string,
  serviceId: string,
  staffList?: StaffMember[]
): boolean {
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return true;
  if (forSvc.some((l) => l.staff_id === staffId)) return true;
  const st = staffList?.find((e) => e.id === staffId);
  if (!st?.active) return false;
  const r = normalizeRoles(st.roles);
  return r.includes("manager") || r.includes("admin") || r.includes("owner");
}

export function servicesEligibleForStaff(
  services: ServiceListingRow[],
  links: StaffServiceRow[],
  staffId: string,
  staffRow?: Pick<StaffMember, "roles" | "active"> | null
): ServiceListingRow[] {
  const active = services.filter((s) => serviceListingIsActive(s));
  const forSt = links.filter((l) => l.staff_id === staffId);
  if (forSt.length === 0) return active;
  if (
    staffRow?.active &&
    (hasStaffRole(staffRow, "manager") ||
      hasStaffRole(staffRow, "admin") ||
      hasStaffRole(staffRow, "owner"))
  ) {
    return active;
  }
  const ids = new Set(forSt.map((l) => l.service_id));
  return active.filter((s) => ids.has(s.id));
}
