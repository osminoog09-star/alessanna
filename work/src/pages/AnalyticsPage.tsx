import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isBefore, parseISO, startOfDay, subDays } from "date-fns";
import { supabase } from "../lib/supabase";
import { useAnalyticsRealtime } from "../hooks/useSalonRealtime";
import { eurFromCents, eurFromEuroAmount } from "../lib/format";
import { normalizeEmployeeRow } from "../lib/roles";
import type { BookingRow, EmployeeRow, ServiceRow, EarningRow } from "../types/database";

export function AnalyticsPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [b, e, s, er] = await Promise.all([
      supabase.from("bookings").select("*").neq("status", "cancelled"),
      supabase.from("employees").select("*"),
      supabase.from("services").select("*"),
      supabase.from("earnings").select("*").order("date", { ascending: false }),
    ]);
    if (b.data) setBookings(b.data as BookingRow[]);
    if (e.data) setEmployees((e.data as EmployeeRow[]).map(normalizeEmployeeRow));
    if (s.data) setServices(s.data as ServiceRow[]);
    if (er.data) setEarnings(er.data as EarningRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAnalyticsRealtime(load);

  const byEmployee = useMemo(() => {
    const map = new Map<number, { count: number; revenueCents: number }>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      const svc = services.find((x) => x.id === b.service_id);
      const cents = svc?.price_cents ?? 0;
      const cur = map.get(b.employee_id) ?? { count: 0, revenueCents: 0 };
      cur.count += 1;
      if (b.status === "confirmed") {
        cur.revenueCents += cents;
      }
      map.set(b.employee_id, cur);
    }
    return map;
  }, [bookings, services]);

  const popularServices = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      map.set(b.service_id, (map.get(b.service_id) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [bookings]);

  const earningsByEmployee = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of earnings) {
      map.set(r.employee_id, (map.get(r.employee_id) ?? 0) + Number(r.amount));
    }
    return map;
  }, [earnings]);

  const utilization30d = useMemo(() => {
    const since = startOfDay(subDays(new Date(), 30));
    const map = new Map<number, number>();
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      try {
        const iso = b.appointment_at || b.start_at;
        if (!iso) continue;
        const at = parseISO(iso);
        if (isBefore(at, since)) continue;
      } catch {
        continue;
      }
      const svc = services.find((x) => x.id === b.service_id);
      const mins = (svc?.duration_min ?? 0) + (svc?.buffer_after_min ?? 0);
      map.set(b.employee_id, (map.get(b.employee_id) ?? 0) + mins);
    }
    return map;
  }, [bookings, services]);

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("analytics.title")}</h1>
        <p className="text-sm text-zinc-500">{t("analytics.subtitle")}</p>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-white">{t("analytics.revenueByEmployee")}</h2>
        <p className="mt-1 text-xs text-zinc-600">{t("analytics.revenueNote")}</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("analytics.colEmployee")}</th>
                <th className="px-4 py-3">{t("analytics.colBookings")}</th>
                <th className="px-4 py-3">{t("analytics.colRevenue")}</th>
                <th className="px-4 py-3">{t("analytics.colEarnings")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {employees.map((em) => {
                const st = byEmployee.get(em.id) ?? { count: 0, revenueCents: 0 };
                const ear = earningsByEmployee.get(em.id) ?? 0;
                return (
                  <tr key={em.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-white">{em.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{st.count}</td>
                    <td className="px-4 py-3 text-zinc-400">{eurFromCents(st.revenueCents)}</td>
                    <td className="px-4 py-3 text-zinc-400">{eurFromEuroAmount(ear)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white">{t("analytics.utilizationTitle")}</h2>
        <p className="mt-1 text-xs text-zinc-600">{t("analytics.utilizationHint")}</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[360px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("analytics.colEmployee")}</th>
                <th className="px-4 py-3">{t("analytics.colBookedMinutes")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {employees.map((em) => {
                const mins = utilization30d.get(em.id) ?? 0;
                return (
                  <tr key={em.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-white">{em.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{mins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white">{t("analytics.popular")}</h2>
        <ul className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          {popularServices.length === 0 && <li className="text-sm text-zinc-500">{t("analytics.noData")}</li>}
          {popularServices.map(([id, count]) => {
            const sv = services.find((s) => s.id === id);
            return (
              <li key={id} className="flex justify-between text-sm text-zinc-300">
                <span>{sv?.name_et ?? t("analytics.unknownService", { id })}</span>
                <span className="text-zinc-500">{t("analytics.bookingsCount", { count })}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
