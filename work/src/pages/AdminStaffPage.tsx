import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useEmployeesDirectoryRealtime, useStaffAssignmentsCatalogRealtime } from "../hooks/useSalonRealtime";
import { normalizeRoles, sanitizeRolesForSave } from "../lib/roles";
import type { StaffServiceRow, StaffTableRow } from "../types/database";
import type { Role } from "../types/database";

type UiRole = Role;
type CatalogSkillService = {
  id: string;
  name: string;
  is_active: boolean;
};

async function loadStaffPageCatalog(): Promise<CatalogSkillService[]> {
  const sLegacy = await supabase.from("services").select("id,name_et,active").order("sort_order", { ascending: true });
  if (!sLegacy.error && sLegacy.data && sLegacy.data.length > 0) {
    return (sLegacy.data as Array<{ id: unknown; name_et?: string; active?: boolean }>)
      .map((s) => ({
        id: String(s.id),
        name: String(s.name_et || "").trim(),
        is_active: s.active !== false,
      }))
      .filter((x) => x.name);
  }
  let sModern = await supabase.from("services").select("id,name,active,is_active").order("name", { ascending: true });
  if (sModern.data && sModern.data.length > 0) {
    return (sModern.data as Array<{ id: unknown; name?: string; active?: boolean; is_active?: boolean }>)
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || "").trim(),
        is_active: s.is_active !== false && s.active !== false,
      }))
      .filter((x) => x.name);
  }
  let sl = await supabase.from("service_listings").select("id,name,is_active").order("name", { ascending: true });
  if (sl.error && String(sl.error.message || "").includes("is_active")) {
    sl = await supabase.from("service_listings").select("id,name").order("name", { ascending: true });
  }
  if (!sl.error && sl.data && sl.data.length > 0) {
    return (sl.data as Array<{ id: string; name?: string; is_active?: boolean }>).map((s) => ({
      id: String(s.id),
      name: String(s.name || "").trim(),
      is_active: s.is_active !== false,
    })).filter((x) => x.name);
  }
  return [];
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function AdminStaffPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffTableRow[]>([]);
  const [services, setServices] = useState<CatalogSkillService[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [newRoles, setNewRoles] = useState<UiRole[]>(["worker"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  /** Компактный список: детали (роли, услуги) только в раскрытой строке. */
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setErr(null);
    const [st, lk] = await Promise.all([
      supabase.from("staff").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.error) {
      setErr(st.error.message);
      setLoading(false);
      return;
    }
    setRows((st.data ?? []) as StaffTableRow[]);
    setServices(await loadStaffPageCatalog());
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEmployeesDirectoryRealtime(load);
  useStaffAssignmentsCatalogRealtime(load);

  const activeServices = useMemo(() => services.filter((s) => s.is_active), [services]);

  function pickPrimaryRole(roles: UiRole[]): UiRole {
    if (roles.includes("admin")) return "admin";
    if (roles.includes("manager")) return "manager";
    return "worker";
  }

  function rowRoles(row: StaffTableRow): UiRole[] {
    const normalized = normalizeRoles((row as StaffTableRow & { roles?: unknown }).roles ?? row.role);
    return normalized as UiRole[];
  }

  function roleLabelsSummary(r: StaffTableRow): string {
    const pr = String(r.role || "").toLowerCase();
    if (pr === "owner") return "Owner";
    const cur = rowRoles(r);
    const bits: string[] = [];
    if (cur.includes("admin")) bits.push(t("role.admin"));
    if (cur.includes("manager")) bits.push(t("role.manager"));
    if (cur.includes("worker")) bits.push(t("role.worker"));
    return bits.length ? bits.join(" · ") : "—";
  }

  function toggleRowExpanded(id: string) {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleRoleToken(current: UiRole[], roleToken: UiRole, on: boolean): UiRole[] {
    const next = on ? [...new Set([...current, roleToken])] : current.filter((r) => r !== roleToken);
    return (next.length ? next : ["worker"]) as UiRole[];
  }

  async function updateStaffRoles(id: string, currentDbRoles: UiRole[], nextUiRoles: UiRole[]) {
    const nextRoles = sanitizeRolesForSave(nextUiRoles, true, currentDbRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(nextRoles);
    setErr(null);
    const { error } = await supabase.from("staff").update({ role: primaryRole, roles: nextRoles }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  function startEdit(r: StaffTableRow) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPhone(r.phone ?? "");
    setExpandedById((prev) => ({ ...prev, [r.id]: true }));
  }

  async function saveEdit() {
    if (!editingId) return;
    setErr(null);
    const { error } = await supabase
      .from("staff")
      .update({
        name: editName.trim(),
        phone: digitsOnly(editPhone) || null,
      })
      .eq("id", editingId);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function updateStaffActive(id: string, is_active: boolean) {
    setErr(null);
    const { error } = await supabase.from("staff").update({ is_active }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function updateStaffMarketingVisibility(id: string, show: boolean) {
    setErr(null);
    let { error } = await supabase.from("staff").update({ show_on_marketing_site: show }).eq("id", id);
    if (error && String(error.message || "").toLowerCase().includes("show_on_marketing_site")) {
      setErr("Нужна миграция БД: staff.show_on_marketing_site (см. supabase/migrations/020_staff_show_on_marketing_site.sql).");
      return;
    }
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPhone = digitsOnly(phone);
    const n = name.trim();
    if (!cleanPhone || !n) {
      setErr("Phone and name are required.");
      return;
    }
    const normalizedNewRoles = sanitizeRolesForSave(newRoles, true, newRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(normalizedNewRoles);
    const { error } = await supabase.from("staff").insert({
      phone: cleanPhone,
      name: n,
      role: primaryRole,
      roles: normalizedNewRoles,
      is_active: true,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setPhone("");
    setName("");
    setNewRoles(["worker"]);
    void load();
  }

  async function remove(row: StaffTableRow) {
    setErr(null);
    if (!window.confirm(`Delete ${row.name} permanently?`)) return;
    const { error } = await supabase.from("staff").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function toggleService(staffId: string, serviceId: string, on: boolean) {
    setErr(null);
    if (on) {
      let { error } = await supabase
        .from("staff_services")
        .insert({ staff_id: staffId, service_id: serviceId, show_on_site: true });
      if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
        error = (await supabase.from("staff_services").insert({ staff_id: staffId, service_id: serviceId })).error;
      }
      if (error) setErr(error.message);
    } else {
      const { error } = await supabase
        .from("staff_services")
        .delete()
        .eq("staff_id", staffId)
        .eq("service_id", serviceId);
      if (error) setErr(error.message);
    }
    void load();
  }

  async function toggleShowOnSiteForLink(staffId: string, serviceId: string, show: boolean) {
    setErr(null);
    let { error } = await supabase
      .from("staff_services")
      .update({ show_on_site: show })
      .eq("staff_id", staffId)
      .eq("service_id", serviceId);
    if (error && String(error.message || "").toLowerCase().includes("show_on_site")) return;
    if (error) setErr(error.message);
    void load();
  }

  function hasLink(staffId: string, serviceId: string) {
    return links.some((l) => l.staff_id === staffId && String(l.service_id) === serviceId);
  }

  function assignedServicesForStaff(staffId: string) {
    return links
      .filter((l) => l.staff_id === staffId)
      .map((l) => {
        const sid = l.service_id != null ? String(l.service_id) : "";
        const svc = services.find((s) => String(s.id) === sid);
        return {
          serviceId: sid,
          name: svc?.name?.trim() || (sid ? `Услуга ${sid}` : "Неизвестная услуга"),
          show_on_site: l.show_on_site !== false,
        };
      })
      .filter((x) => x.serviceId);
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-5xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">{t("nav.adminStaff")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("adminStaff.subtitle")}</p>
      </header>

      {err && (
        <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>
      )}

      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3 border border-zinc-800 bg-zinc-950 p-4">
        <div>
          <label className="block text-xs text-zinc-500">{t("login.phone")}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            placeholder="37255686845"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">{t("adminStaff.name")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">{t("role.label")}</label>
          <div className="mt-1 flex flex-wrap gap-3 rounded border border-zinc-700 bg-black px-2 py-1 text-sm">
            {(["admin", "manager", "worker"] as UiRole[]).map((r) => (
              <label key={r} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={newRoles.includes(r)}
                  onChange={(e) => setNewRoles((prev) => toggleRoleToken(prev, r, e.target.checked))}
                />
                {r === "admin" ? t("role.admin") : r === "manager" ? t("role.manager") : t("role.worker")}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
          {t("common.add")}
        </button>
      </form>

      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="border-b border-zinc-800 px-3 py-2">{t("login.phone")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.name")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.roleBrief")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.active")}</th>
              <th className="min-w-[8rem] border-b border-zinc-800 px-3 py-2 text-xs font-normal text-zinc-500">
                Сайт / запись
              </th>
              <th className="min-w-[10rem] border-b border-zinc-800 px-3 py-2">{t("adminStaff.services")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const assigned = assignedServicesForStaff(r.id);
              const expanded = !!expandedById[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-zinc-800/80 align-middle">
                    <td className="px-3 py-2 font-mono text-zinc-300">
                      {editingId === r.id ? (
                        <input
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.phone ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === r.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2 text-xs text-zinc-400">{roleLabelsSummary(r)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ToggleSwitch
                          checked={r.is_active}
                          onCheckedChange={(v) => void updateStaffActive(r.id, v)}
                          aria-label={`${r.name}: активен в CRM`}
                        />
                        <span className="text-zinc-500">{r.is_active ? t("adminStaff.yes") : t("adminStaff.no")}</span>
                      </div>
                    </td>
                    <td className="max-w-[8rem] px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ToggleSwitch
                          checked={r.show_on_marketing_site !== false}
                          onCheckedChange={(v) => void updateStaffMarketingVisibility(r.id, v)}
                          aria-label={`${r.name}: на главном сайте и в публичной записи`}
                        />
                        <span className="text-zinc-500">
                          {r.show_on_marketing_site !== false ? t("adminStaff.yes") : t("adminStaff.no")}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-zinc-500">
                          {assigned.length === 0
                            ? t("adminStaff.assignedNone")
                            : t("adminStaff.assignedCount", { count: assigned.length })}
                        </span>
                        <button
                          type="button"
                          className="w-fit rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-left text-xs text-zinc-200 hover:border-zinc-500 hover:text-white"
                          onClick={() => toggleRowExpanded(r.id)}
                        >
                          {expanded ? t("adminStaff.collapseRow") : t("adminStaff.expandRow")}
                        </button>
                      </div>
                    </td>
                    <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                      {editingId === r.id ? (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => void saveEdit()}>
                            {t("common.save")}
                          </button>
                          <button type="button" className="text-zinc-500 underline" onClick={() => setEditingId(null)}>
                            {t("common.cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => startEdit(r)}>
                            {t("adminStaff.edit")}
                          </button>
                          <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                            delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-zinc-800/80 bg-zinc-950/50 align-top">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="flex flex-col gap-4 text-sm">
                          <div>
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                              {t("role.label")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(["admin", "manager", "worker"] as UiRole[]).map((roleToken) => {
                                const current = rowRoles(r);
                                return (
                                  <label key={roleToken} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                                    <input
                                      type="checkbox"
                                      checked={current.includes(roleToken)}
                                      onChange={(e) =>
                                        void updateStaffRoles(
                                          r.id,
                                          current,
                                          toggleRoleToken(current, roleToken, e.target.checked),
                                        )
                                      }
                                    />
                                    {roleToken === "admin"
                                      ? t("role.admin")
                                      : roleToken === "manager"
                                        ? t("role.manager")
                                        : t("role.worker")}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                              <span className="text-[11px] font-medium uppercase text-zinc-500">{t("adminStaff.active")}</span>
                              <div className="flex items-center gap-2 text-xs">
                                <ToggleSwitch
                                  checked={r.is_active}
                                  onCheckedChange={(v) => void updateStaffActive(r.id, v)}
                                  aria-label={`${r.name}: активен в CRM`}
                                />
                                <span className="text-zinc-400">{r.is_active ? "Активен" : "Неактивен"}</span>
                              </div>
                              <span className="text-[10px] text-zinc-600">
                                {r.is_active ? "может входить и попадать в списки" : "не входит в работу салона"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                              <span className="text-[11px] font-medium uppercase text-zinc-500">Сайт / запись</span>
                              <div className="flex items-center gap-2 text-xs">
                                <ToggleSwitch
                                  checked={r.show_on_marketing_site !== false}
                                  onCheckedChange={(v) => void updateStaffMarketingVisibility(r.id, v)}
                                  aria-label={`${r.name}: на главном сайте и в публичной записи`}
                                />
                                <span className="text-zinc-400">
                                  {r.show_on_marketing_site !== false ? "виден" : "скрыт"}
                                </span>
                              </div>
                              <span className="text-[10px] leading-snug text-zinc-600">
                                Теневой режим: выключите для продакшена, включите — появится в блоке «Мастера» и в
                                онлайн-записи (для теста услуг).
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 rounded border border-zinc-800/80 bg-black/20 px-2 py-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                                Назначено явно
                              </p>
                              {assigned.length === 0 ? (
                                <p className="mt-1 text-xs text-zinc-500">
                                  Нет привязок к услугам. На услугах без своего списка мастеров этот мастер всё равно
                                  может подставляться вместе со всеми активными.
                                </p>
                              ) : (
                                <ul className="mt-1 space-y-1.5 text-xs text-zinc-200">
                                  {assigned.map((a) => (
                                    <li
                                      key={a.serviceId}
                                      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-800/60 pb-1 last:border-0 last:pb-0"
                                    >
                                      <span className="min-w-0 flex-1 font-medium text-zinc-100">{a.name}</span>
                                      <span
                                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                          a.show_on_site
                                            ? "border border-emerald-800/60 text-emerald-300"
                                            : "border border-amber-800/60 text-amber-200"
                                        }`}
                                      >
                                        {a.show_on_site ? "на сайте" : "только CRM"}
                                      </span>
                                      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                                        <ToggleSwitch
                                          size="sm"
                                          checked={a.show_on_site}
                                          onCheckedChange={(v) => void toggleShowOnSiteForLink(r.id, a.serviceId, v)}
                                          aria-label={`${a.name}: на сайте`}
                                        />
                                        <span>сайт</span>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <p className="mb-1 text-[11px] text-zinc-500">
                              Отметьте услуги, чтобы ограничить этого мастера.
                            </p>
                            <div className="max-h-44 overflow-y-auto rounded border border-zinc-800/60 p-2">
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {activeServices.map((s) => (
                                  <div key={s.id} className="flex max-w-[11rem] items-center gap-1.5 text-xs text-zinc-400">
                                    <ToggleSwitch
                                      size="sm"
                                      checked={hasLink(r.id, s.id)}
                                      onCheckedChange={(v) => void toggleService(r.id, s.id, v)}
                                      aria-label={`${r.name}: ${s.name}`}
                                    />
                                    <span className="min-w-0 truncate" title={s.name}>
                                      {s.name}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {activeServices.length === 0 && (
                                <p className="text-xs text-zinc-500">
                                  Каталог услуг пуст — добавьте услуги на странице «Услуги».
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
