import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import type { BookingRow, EmployeeRow, ServiceRow } from "../types/database";

export function BookingsPage() {
  const { t } = useTranslation();
  const { employee, canManage, isStaffOnly } = useAuth();
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [b, e, s] = await Promise.all([
      supabase.from("bookings").select("*").order("start_at", { ascending: false }),
      supabase.from("employees").select("id,name"),
      supabase.from("services").select("id,name_et"),
    ]);
    if (b.data) setRows(b.data as BookingRow[]);
    if (e.data) setEmployees(e.data as EmployeeRow[]);
    if (s.data) setServices(s.data as ServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const visible = rows.filter((r) => {
    if (isStaffOnly && employee) return r.employee_id === employee.id;
    return true;
  });

  async function cancelBooking(id: number) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (canManage) {
      /* ok */
    } else if (isStaffOnly && employee && row.employee_id === employee.id) {
      /* ok */
    } else {
      return;
    }
    let q = supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (!canManage && isStaffOnly && employee) {
      q = q.eq("employee_id", employee.id);
    }
    await q;
    load();
  }

  function statusLabel(status: string) {
    if (status === "pending") return t("bookings.statusPending");
    if (status === "confirmed") return t("bookings.statusConfirmed");
    if (status === "cancelled") return t("bookings.statusCancelled");
    return status;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("bookings.title")}</h1>
        <p className="text-sm text-zinc-500">{t("bookings.subtitle")}</p>
      </header>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("bookings.when")}</th>
                <th className="px-4 py-3">{t("bookings.client")}</th>
                <th className="px-4 py-3">{t("bookings.staff")}</th>
                <th className="px-4 py-3">{t("bookings.service")}</th>
                <th className="px-4 py-3">{t("bookings.status")}</th>
                {(canManage || (isStaffOnly && employee)) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {visible.map((b) => {
                const when = b.appointment_at || b.start_at;
                const em = employees.find((x) => x.id === b.employee_id);
                const sv = services.find((x) => x.id === b.service_id);
                return (
                  <tr key={b.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-zinc-300">
                      {when ? format(parseISO(when), "yyyy-MM-dd HH:mm") : t("common.dash")}
                    </td>
                    <td className="px-4 py-3 text-white">{b.client_name}</td>
                    <td className="px-4 py-3 text-zinc-400">{em?.name ?? t("common.dash")}</td>
                    <td className="px-4 py-3 text-zinc-400">{sv?.name_et ?? t("common.dash")}</td>
                    <td className="px-4 py-3 capitalize text-zinc-400">{statusLabel(b.status)}</td>
                    {(canManage || (isStaffOnly && employee)) && (
                      <td className="px-4 py-3">
                        {b.status !== "cancelled" && (
                          <button
                            type="button"
                            onClick={() => void cancelBooking(b.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            {t("bookings.cancel")}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
