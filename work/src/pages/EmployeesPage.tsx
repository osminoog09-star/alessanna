import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { EmployeeRow, ServiceRow, EmployeeServiceRow, StaffRole } from "../types/database";
import { useEmployeesDirectoryRealtime } from "../hooks/useSalonRealtime";
import { hasStaffRole, normalizeEmployeeRow, normalizeRoles, sanitizeRolesForSave } from "../lib/roles";

const ROLE_OPTIONS: StaffRole[] = ["admin", "manager", "staff"];

export function EmployeesPage() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [serverEmployees, setServerEmployees] = useState<EmployeeRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [links, setLinks] = useState<EmployeeServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [e, s, l] = await Promise.all([
      supabase.from("employees").select("*").order("name"),
      supabase.from("services").select("id,name_et,active").eq("active", true),
      supabase.from("employee_services").select("*"),
    ]);
    if (e.data) {
      const rows = (e.data as EmployeeRow[]).map(normalizeEmployeeRow);
      setEmployees(rows);
      setServerEmployees(rows);
    }
    if (s.data) setServices(s.data as ServiceRow[]);
    if (l.data) setLinks(l.data as EmployeeServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEmployeesDirectoryRealtime(load);

  async function saveRow(em: EmployeeRow) {
    if (!isAdmin) return;
    const stored = serverEmployees.find((x) => x.id === em.id)?.roles;
    await supabase
      .from("employees")
      .update({
        name: em.name,
        phone: em.phone,
        roles: sanitizeRolesForSave(normalizeRoles(em.roles), isAdmin, stored),
        payroll_type: em.payroll_type,
        commission: em.commission,
        fixed_salary: em.fixed_salary,
        active: em.active,
      })
      .eq("id", em.id);
    load();
  }

  async function persistRoles(nextRow: EmployeeRow, storedSnapshot: StaffRole[] | undefined) {
    if (!isAdmin) return;
    const roles = sanitizeRolesForSave(normalizeRoles(nextRow.roles), isAdmin, storedSnapshot);
    await supabase.from("employees").update({ roles }).eq("id", nextRow.id);
    load();
  }

  function toggleRole(em: EmployeeRow, role: StaffRole, checked: boolean) {
    if (!isAdmin) return;
    if (role === "admin" && !isAdmin) return;
    let next = normalizeRoles(em.roles);
    if (checked) next = [...new Set([...next, role])];
    else next = next.filter((x) => x !== role);
    const stored = serverEmployees.find((x) => x.id === em.id)?.roles;
    const safe = sanitizeRolesForSave(next, isAdmin, stored);
    const updated = { ...em, roles: safe };
    setEmployees((prev) => prev.map((x) => (x.id === em.id ? updated : x)));
    void persistRoles(updated, stored);
  }

  async function toggleService(employeeId: number, serviceId: number, on: boolean) {
    if (!isAdmin) return;
    if (on) {
      await supabase.from("employee_services").insert({ employee_id: employeeId, service_id: serviceId });
    } else {
      await supabase
        .from("employee_services")
        .delete()
        .eq("employee_id", employeeId)
        .eq("service_id", serviceId);
    }
    load();
  }

  async function addEmployee() {
    if (!isAdmin) return;
    await supabase.from("employees").insert({
      name: t("employees.newStaffDefault"),
      phone: "",
      email: null,
      active: true,
      roles: ["staff"],
      payroll_type: "percent",
      commission: 0,
      fixed_salary: 0,
    });
    load();
  }

  function linked(empId: number, svcId: number) {
    return links.some((l) => l.employee_id === empId && l.service_id === svcId);
  }

  async function deleteEmployeePermanently(em: EmployeeRow) {
    if (!isAdmin) return;
    if (!isAdmin && hasStaffRole(em, "admin")) return;
    if (!window.confirm(t("employees.deleteConfirm", { name: em.name }))) return;
    const { count, error: cErr } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", em.id);
    if (cErr) return;
    if ((count ?? 0) > 0) {
      window.alert(t("employees.deleteBlockedBookings"));
      return;
    }
    await supabase.from("employee_services").delete().eq("employee_id", em.id);
    await supabase.from("schedules").delete().eq("employee_id", em.id);
    const { error } = await supabase.from("employees").delete().eq("id", em.id);
    if (error) {
      window.alert(t("employees.deleteFailed"));
      return;
    }
    load();
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("employees.title")}</h1>
          <p className="text-sm text-zinc-500">{t("employees.subtitle")}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void addEmployee()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t("employees.addEmployee")}
          </button>
        )}
      </header>

      <div className="space-y-8">
        {employees.map((em) => (
          <div key={em.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-xs text-zinc-500">
                {t("employees.name")}
                <input
                  disabled={!isAdmin}
                  value={em.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? { ...x, name: v } : x)));
                  }}
                  onBlur={() => void saveRow(em)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                />
              </label>
              <label className="block text-xs text-zinc-500">
                {t("employees.phone")}
                <input
                  disabled={!isAdmin}
                  value={em.phone ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? { ...x, phone: v } : x)));
                  }}
                  onBlur={() => void saveRow(em)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={em.active}
                  onChange={(e) => {
                    const active = e.target.checked;
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? { ...x, active } : x)));
                    void saveRow({ ...em, active });
                  }}
                />
                {t("employees.activeBookable")}
              </label>
              <fieldset
                disabled={!isAdmin}
                className="md:col-span-2 lg:col-span-3 rounded-lg border border-zinc-800 p-3"
              >
                <legend className="px-1 text-xs text-zinc-500">{t("employees.accessRoles")}</legend>
                <div className="mt-2 flex flex-wrap gap-4">
                  {ROLE_OPTIONS.map((role) => {
                    const checked = normalizeRoles(em.roles).includes(role);
                    const disabledAdmin = role === "admin" && !isAdmin;
                    return (
                      <label
                        key={role}
                        className={`flex items-center gap-2 text-sm text-zinc-300 ${disabledAdmin ? "opacity-50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabledAdmin}
                          onChange={(e) => toggleRole(em, role, e.target.checked)}
                        />
                        {t(`role.${role}`)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className="block text-xs text-zinc-500">
                {t("employees.payroll")}
                <select
                  disabled={!isAdmin}
                  value={em.payroll_type}
                  onChange={(e) => {
                    const payroll_type = e.target.value as EmployeeRow["payroll_type"];
                    const next = { ...em, payroll_type };
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? next : x)));
                    void saveRow(next);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                >
                  <option value="percent">{t("employees.payrollPercent")}</option>
                  <option value="fixed">{t("employees.payrollFixed")}</option>
                </select>
              </label>
              <label className="block text-xs text-zinc-500">
                {t("employees.commission")}
                <input
                  type="number"
                  disabled={!isAdmin}
                  value={em.commission}
                  onChange={(e) => {
                    const commission = Number(e.target.value);
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? { ...x, commission } : x)));
                  }}
                  onBlur={() => void saveRow(em)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                />
              </label>
              <label className="block text-xs text-zinc-500">
                {t("employees.fixedSalary")}
                <input
                  type="number"
                  disabled={!isAdmin}
                  value={em.fixed_salary}
                  onChange={(e) => {
                    const fixed_salary = Number(e.target.value);
                    setEmployees((prev) => prev.map((x) => (x.id === em.id ? { ...x, fixed_salary } : x)));
                  }}
                  onBlur={() => void saveRow(em)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
                />
              </label>
            </div>
            {isAdmin && (
              <div className="mt-4 border-t border-zinc-800 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {t("employees.skillsServices")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm text-zinc-400">
                      <input
                        type="checkbox"
                        checked={linked(em.id, s.id)}
                        onChange={(e) => void toggleService(em.id, s.id, e.target.checked)}
                      />
                      {s.name_et}
                    </label>
                  ))}
                </div>
                {(!isAdmin && hasStaffRole(em, "admin")) ? null : (
                  <button
                    type="button"
                    onClick={() => void deleteEmployeePermanently(em)}
                    className="mt-4 text-xs font-medium text-red-400 hover:text-red-300"
                  >
                    {t("employees.deletePermanent")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
