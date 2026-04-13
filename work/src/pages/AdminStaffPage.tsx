import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useServicesCatalogRealtime, useStaffDirectoryRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { normalizeRoles, sanitizeRolesForSave } from "../lib/roles";
import type { ServiceListingRow, StaffServiceRow, StaffTableRow, StaffWorkType } from "../types/database";
import type { Role } from "../types/database";

type UiRole = Role;

const ALL_ROLES: Role[] = ["owner", "admin", "manager", "worker"];
const MANAGER_ASSIGABLE_ROLES: Role[] = ["manager", "worker"];

function primaryRoleFromRoles(roles: Role[]): Role {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("manager")) return "manager";
  return "worker";
}

function isProtectedAccountRole(raw: unknown): boolean {
  const roles = normalizeRoles(raw);
  return roles.includes("admin") || roles.includes("owner");
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function AdminStaffPage() {
  const { t } = useTranslation();
  const { isPrivilegedAdmin } = useAuth();
  const [rows, setRows] = useState<StaffTableRow[]>([]);
  const [services, setServices] = useState<ServiceListingRow[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [newRoles, setNewRoles] = useState<Role[]>(["worker"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    const [st, sv, lk] = await Promise.all([
      supabase.from("staff").select("*").order("created_at", { ascending: false }),
      supabase.from("service_listings").select("id,name,is_active").order("sort_order", { ascending: true }),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.error) {
      setErr(st.error.message);
      setLoading(false);
      return;
    }
    setRows((st.data ?? []) as StaffTableRow[]);
    if (sv.data) setServices(sv.data as ServiceListingRow[]);
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useStaffDirectoryRealtime(load);
  useServicesCatalogRealtime(load);

  const activeServices = useMemo(() => services.filter((s) => s.is_active), [services]);

  const assignableRoles = isPrivilegedAdmin ? ALL_ROLES : MANAGER_ASSIGABLE_ROLES;

  function rowRoles(r: StaffTableRow): Role[] {
    return normalizeRoles((r as { roles?: unknown }).roles ?? r.role);
  }

  function toggleRoleValue(roles: Role[], role: Role, checked: boolean): Role[] {
    if (checked) return [...new Set([...roles, role])];
    const next = roles.filter((x) => x !== role);
    return next.length ? next : ["worker"];
  }

  function startEdit(r: StaffTableRow) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPhone(r.phone ?? "");
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

  async function updateStaffRoles(id: string, edited: Role[]) {
    setErr(null);
    const target = rows.find((x) => x.id === id);
    if (!target) return;
    const existing = rowRoles(target);
    const nextRoles = sanitizeRolesForSave(edited, isPrivilegedAdmin, existing);
    if (!isPrivilegedAdmin) {
      if (isProtectedAccountRole(existing)) return;
    }
    const { error } = await supabase
      .from("staff")
      .update({ roles: nextRoles, role: primaryRoleFromRoles(nextRoles) })
      .eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
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

  async function updateStaffCompensation(
    id: string,
    patch: { work_type?: StaffWorkType; percent_rate?: number | null; rent_per_day?: number | null }
  ) {
    setErr(null);
    const { error } = await supabase.from("staff").update(patch).eq("id", id);
    if (error) setErr(error.message);
    void load();
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPhone = digitsOnly(phone);
    const n = name.trim();
    if (!cleanPhone || !n) {
      setErr(t("adminStaff.phoneNameRequired"));
      return;
    }
    const { error } = await supabase.from("staff").insert({
      phone: cleanPhone,
      name: n,
      role: primaryRoleFromRoles(newRoles),
      roles: newRoles,
      is_active: true,
      work_type: "percentage",
      percent_rate: 0,
      rent_per_day: 0,
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
    if (!isPrivilegedAdmin && isProtectedAccountRole((row as { roles?: unknown }).roles ?? row.role)) return;
    if (!window.confirm(t("adminStaff.deleteStaffConfirm", { name: row.name }))) return;
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
      const { error } = await supabase.from("staff_services").insert({ staff_id: staffId, service_id: serviceId });
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

  function hasLink(staffId: string, serviceId: string) {
    return links.some((l) => l.staff_id === staffId && l.service_id === serviceId);
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
            placeholder={t("login.placeholder")}
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
          <div className="mt-1 flex flex-wrap gap-2 rounded border border-zinc-700 bg-black p-2 text-xs">
            {assignableRoles.map((opt) => (
              <label key={opt} className="inline-flex items-center gap-1 text-zinc-300">
                <input
                  type="checkbox"
                  checked={newRoles.includes(opt)}
                  onChange={(e) => setNewRoles((prev) => toggleRoleValue(prev, opt, e.target.checked))}
                />
                {t(`role.${opt}`)}
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
              <th className="border-b border-zinc-800 px-3 py-2">{t("role.label")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.active")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.payModel")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.percentRate")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.rentPerDay")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.services")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/80 align-top">
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
                <td className="px-3 py-2">
                  {!isPrivilegedAdmin && isProtectedAccountRole((r as { roles?: unknown }).roles ?? r.role) ? (
                    <span className="text-zinc-300">{rowRoles(r).map((x) => t(`role.${x}`)).join(" · ")}</span>
                  ) : (
                    <div className="flex max-w-[16rem] flex-wrap gap-2 rounded border border-zinc-700 bg-black p-1.5 text-xs">
                      {assignableRoles.map((opt) => (
                        <label key={opt} className="inline-flex items-center gap-1 text-zinc-300">
                          <input
                            type="checkbox"
                            checked={rowRoles(r).includes(opt)}
                            onChange={(e) => {
                              const next = toggleRoleValue(rowRoles(r), opt, e.target.checked);
                              void updateStaffRoles(r.id, next);
                            }}
                          />
                          {t(`role.${opt}`)}
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={r.is_active}
                      onChange={(e) => void updateStaffActive(r.id, e.target.checked)}
                      className="rounded border-zinc-600"
                    />
                    <span className="text-zinc-400">{r.is_active ? t("adminStaff.yes") : t("adminStaff.no")}</span>
                  </label>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={(r.work_type as StaffWorkType) ?? "percentage"}
                    onChange={(e) =>
                      void updateStaffCompensation(r.id, { work_type: e.target.value as StaffWorkType })
                    }
                    className="max-w-[9rem] rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs text-white"
                  >
                    <option value="percentage">{t("adminStaff.payPercentage")}</option>
                    <option value="rent">{t("adminStaff.payRent")}</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    defaultValue={r.percent_rate ?? ""}
                    key={`pct-${r.id}-${r.percent_rate ?? "x"}`}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v != null && Number.isFinite(v)) void updateStaffCompensation(r.id, { percent_rate: v });
                    }}
                    className="w-16 rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={r.rent_per_day ?? ""}
                    key={`rent-${r.id}-${r.rent_per_day ?? "x"}`}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v != null && Number.isFinite(v)) void updateStaffCompensation(r.id, { rent_per_day: v });
                    }}
                    className="w-16 rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="max-w-xs px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {activeServices.map((s) => (
                      <label key={s.id} className="flex items-center gap-1 text-xs text-zinc-400">
                        <input
                          type="checkbox"
                          checked={hasLink(r.id, s.id)}
                          onChange={(e) => void toggleService(r.id, s.id, e.target.checked)}
                        />
                        {s.name}
                      </label>
                    ))}
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
                      {(!isProtectedAccountRole((r as { roles?: unknown }).roles ?? r.role) || isPrivilegedAdmin) && (
                        <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                          {t("adminStaff.deleteShort")}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
