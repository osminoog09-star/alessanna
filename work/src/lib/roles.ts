import type { EmployeeRow, EmployeeServiceRow, ServiceRow, StaffRole } from "../types/database";

export type { StaffRole };

const ALLOWED: readonly StaffRole[] = ["admin", "manager", "staff"];

/** Map legacy / invalid tokens to canonical roles. */
function mapRoleToken(x: unknown): StaffRole | null {
  if (typeof x !== "string") return null;
  const l = x.toLowerCase().trim();
  if (l === "viewer" || l === "employee") return "staff";
  if (l === "admin" || l === "manager" || l === "staff") return l;
  return null;
}

export function normalizeRoles(raw: unknown): StaffRole[] {
  if (Array.isArray(raw)) {
    const out = raw.map(mapRoleToken).filter((x): x is StaffRole => x != null);
    const uniq = [...new Set(out)];
    return uniq.length ? uniq : ["staff"];
  }
  const single = mapRoleToken(raw);
  if (single) return [single];
  return ["staff"];
}

/** Merge stored CRM row (legacy single `role` or Postgres/JSON shapes). */
export function normalizeEmployeeRow(row: EmployeeRow | (Record<string, unknown> & { id?: number })): EmployeeRow {
  const r = row as Record<string, unknown> & { id: number };
  const roles = normalizeRoles(r.roles ?? r.role);
  const rest = { ...r } as Record<string, unknown>;
  delete rest.role;
  delete rest.roles;
  return { ...(rest as Omit<EmployeeRow, "roles">), roles };
}

export function hasStaffRole(employee: Pick<EmployeeRow, "roles"> | null | undefined, role: StaffRole): boolean {
  if (!employee?.roles?.length) return false;
  return normalizeRoles(employee.roles).includes(role);
}

/** Logged-in user has only `staff` (no manager/admin caps). */
export function isStaffOnlyView(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return r.includes("staff") && !r.includes("manager") && !r.includes("admin");
}

/** Managers cannot add/remove admin; admins can set any combination. */
export function sanitizeRolesForSave(
  edited: StaffRole[],
  editorIsAdmin: boolean,
  storedRoles: StaffRole[] | undefined
): StaffRole[] {
  const norm = normalizeRoles(edited);
  const storedNorm = normalizeRoles(storedRoles);
  if (editorIsAdmin) return norm.length ? norm : ["staff"];
  let out = norm.filter((r) => r !== "admin");
  if (storedNorm.includes("admin")) out = [...new Set([...out, "admin"])];
  return out.length ? out : ["staff"];
}

/** Staff who may perform `serviceId` for booking/calendar. */
export function employeesEligibleForService(
  employees: EmployeeRow[],
  links: EmployeeServiceRow[],
  serviceId: number | null
): EmployeeRow[] {
  const active = employees.filter((e) => e.active);
  if (serviceId == null) return active;
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return active;
  const ids = new Set(forSvc.map((l) => l.employee_id));
  return active.filter((e) => ids.has(e.id));
}

/** One employee vs service (same rules as list filtering). */
export function employeeCanPerformService(
  links: EmployeeServiceRow[],
  employeeId: number,
  serviceId: number
): boolean {
  const forSvc = links.filter((l) => l.service_id === serviceId);
  if (forSvc.length === 0) return true;
  return forSvc.some((l) => l.employee_id === employeeId);
}

export function servicesEligibleForEmployee(
  services: ServiceRow[],
  links: EmployeeServiceRow[],
  employeeId: number
): ServiceRow[] {
  const active = services.filter((s) => s.active);
  const forEmp = links.filter((l) => l.employee_id === employeeId);
  if (forEmp.length === 0) return active;
  const ids = new Set(forEmp.map((l) => l.service_id));
  return active.filter((s) => ids.has(s.id));
}
