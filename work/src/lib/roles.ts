import type { Role, ServiceRow, StaffMember, StaffRole, StaffServiceRow } from "../types/database";

export type { Role, StaffRole };

function mapRoleToken(x: unknown): StaffRole | null {
  if (typeof x !== "string") return null;
  const l = x.toLowerCase().trim();
  if (l === "viewer") return null;
  if (l === "employee" || l === "staff") return "worker";
  if (l === "admin" || l === "manager" || l === "worker") return l;
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

/** Line staff only: worker, not manager/admin (after normalization). */
export function isWorkerOnlyView(roles: StaffRole[] | undefined): boolean {
  const r = normalizeRoles(roles);
  return r.includes("worker") && !r.includes("manager") && !r.includes("admin");
}

export function sanitizeRolesForSave(
  edited: StaffRole[],
  editorIsAdmin: boolean,
  storedRoles: StaffRole[] | undefined
): StaffRole[] {
  const norm = normalizeRoles(edited);
  const storedNorm = normalizeRoles(storedRoles);
  if (editorIsAdmin) return attachWorkerForManagers(norm.length ? norm : ["worker"]);
  let out = norm.filter((r) => r !== "admin");
  if (storedNorm.includes("admin")) out = [...new Set([...out, "admin"])];
  return attachWorkerForManagers(out.length ? out : ["worker"]);
}

export function staffEligibleForService(
  staffList: StaffMember[],
  links: StaffServiceRow[],
  serviceId: string | number | null
): StaffMember[] {
  const active = staffList.filter((s) => s.active);
  if (serviceId == null) return active;
  const wantedId = String(serviceId);
  const forSvc = links.filter((l) => String(l.service_id) === wantedId);
  if (forSvc.length === 0) return active;
  const ids = new Set(forSvc.map((l) => l.staff_id));
  return active.filter((e) => {
    if (ids.has(e.id)) return true;
    const r = normalizeRoles(e.roles);
    return r.includes("manager") || r.includes("admin");
  });
}

/** Customer-facing booking: drop masters with show_on_site = false; implicit-all (no rows) unchanged. */
export function applyPublicStaffVisibility(
  eligible: StaffMember[],
  allLinks: StaffServiceRow[],
  serviceId: string | number | null
): StaffMember[] {
  if (serviceId == null) return eligible;
  const wantedId = String(serviceId);
  const raw = allLinks.filter((l) => String(l.service_id) === wantedId);
  if (raw.length === 0) return eligible;
  return eligible.filter((e) => {
    const link = raw.find((l) => String(l.staff_id) === e.id);
    return link != null && link.show_on_site !== false;
  });
}

export function staffCanPerformService(
  links: StaffServiceRow[],
  staffId: string,
  serviceId: string | number,
  staffList?: StaffMember[]
): boolean {
  const wantedId = String(serviceId);
  const forSvc = links.filter((l) => String(l.service_id) === wantedId);
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
  const ids = new Set(forSt.map((l) => String(l.service_id)));
  return active.filter((s) => ids.has(String(s.id)));
}
