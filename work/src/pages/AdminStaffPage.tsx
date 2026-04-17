import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { normalizeRoles, sanitizeRolesForSave } from "../lib/roles";
import type { StaffServiceRow, StaffTableRow } from "../types/database";
import type { Role } from "../types/database";

type UiRole = Role;
type CatalogSkillService = {
  id: string;
  name: string;
  is_active: boolean;
};

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

  const load = useCallback(async () => {
    setErr(null);
    const [st, sv, lk] = await Promise.all([
      supabase.from("staff").select("*").order("created_at", { ascending: false }),
      supabase.from("services").select("id,name,active,is_active").order("name", { ascending: true }),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.error) {
      setErr(st.error.message);
      setLoading(false);
      return;
    }
    setRows((st.data ?? []) as StaffTableRow[]);
    if (sv.data) {
      setServices(
        (sv.data as Array<{ id: string; name?: string; active?: boolean; is_active?: boolean }>).map((s) => ({
          id: String(s.id),
          name: String(s.name || "").trim(),
          is_active: s.is_active !== false && s.active !== false,
        }))
      );
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    return links.some((l) => l.staff_id === staffId && String(l.service_id) === serviceId);
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
              <th className="border-b border-zinc-800 px-3 py-2">{t("role.label")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.active")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.services")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">actions</th>
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
                  <div className="flex flex-wrap gap-2">
                    {(["admin", "manager", "worker"] as UiRole[]).map((roleToken) => {
                      const current = rowRoles(r);
                      return (
                        <label key={roleToken} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                          <input
                            type="checkbox"
                            checked={current.includes(roleToken)}
                            onChange={(e) =>
                              void updateStaffRoles(r.id, current, toggleRoleToken(current, roleToken, e.target.checked))
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
                      <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                        delete
                      </button>
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
