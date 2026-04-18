import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isBefore, parseISO, startOfDay, subDays } from "date-fns";
import { supabase } from "../lib/supabase";
import { useAnalyticsRealtime } from "../hooks/useSalonRealtime";
import { eurFromCents } from "../lib/format";
import { isStaffRowAdmin } from "../lib/roles";
import type { AppointmentRow } from "../types/database";

type StaffRow = { id: string; name: string };
type ServiceMeta = { id: string; name: string; priceCents: number; totalMinutes: number };

export function AnalyticsPage() {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [services, setServices] = useState<ServiceMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    /* Мёржим legacy `services` и актуальный `service_listings` — иначе метрики
     * по записям с uuid service_id (новый каталог) нулевые. */
    const [b, e, legacySvc, listingSvc] = await Promise.all([
      supabase.from("appointments").select("*").neq("status", "cancelled"),
      supabase.from("staff").select("id,name,role,roles").order("name"),
      supabase.from("services").select("id,name_et,price_cents,duration_min,buffer_after_min"),
      supabase.from("service_listings").select("id,name,price,duration,buffer_after_min"),
    ]);
    if (b.data) setAppointments(b.data as AppointmentRow[]);
    if (e.data) {
      /* Админы не работают с клиентами — не фигурируют в выручке/нагрузке. */
      setStaffList((e.data as Array<StaffRow & { role?: unknown; roles?: unknown }>).filter((row) => !isStaffRowAdmin(row)));
    }
    const merged: ServiceMeta[] = [];
    if (legacySvc.data) {
      for (const r of legacySvc.data as Array<{
        id: unknown; name_et: string | null; price_cents: number | null;
        duration_min: number | null; buffer_after_min: number | null;
      }>) {
        merged.push({
          id: String(r.id),
          name: r.name_et ?? "",
          priceCents: Number(r.price_cents ?? 0),
          totalMinutes: Number(r.duration_min ?? 0) + Number(r.buffer_after_min ?? 0),
        });
      }
    }
    if (listingSvc.data) {
      for (const r of listingSvc.data as Array<{
        id: unknown; name: string | null; price: number | null;
        duration: number | null; buffer_after_min: number | null;
      }>) {
        /* `service_listings.price` хранится в евро (numeric), приводим к центам. */
        const euros = Number(r.price ?? 0);
        merged.push({
          id: String(r.id),
          name: r.name ?? "",
          priceCents: Math.round(euros * 100),
          totalMinutes: Number(r.duration ?? 0) + Number(r.buffer_after_min ?? 0),
        });
      }
    }
    setServices(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAnalyticsRealtime(load);

  const serviceById = useMemo(() => {
    const m = new Map<string, ServiceMeta>();
    for (const s of services) m.set(s.id, s);
    return m;
  }, [services]);

  const byStaff = useMemo(() => {
    const map = new Map<string, { count: number; revenueCents: number }>();
    for (const b of appointments) {
      if (b.status === "cancelled") continue;
      const svc = serviceById.get(String(b.service_id));
      const cents = svc?.priceCents ?? 0;
      const cur = map.get(b.staff_id) ?? { count: 0, revenueCents: 0 };
      cur.count += 1;
      if (b.status === "confirmed") {
        cur.revenueCents += cents;
      }
      map.set(b.staff_id, cur);
    }
    return map;
  }, [appointments, serviceById]);

  const popularServices = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of appointments) {
      if (b.status === "cancelled") continue;
      const key = String(b.service_id);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [appointments]);

  const utilization30d = useMemo(() => {
    const since = startOfDay(subDays(new Date(), 30));
    const map = new Map<string, number>();
    for (const b of appointments) {
      if (b.status === "cancelled") continue;
      try {
        const at = parseISO(b.start_time);
        if (isBefore(at, since)) continue;
      } catch {
        continue;
      }
      const svc = serviceById.get(String(b.service_id));
      const mins = svc?.totalMinutes ?? 0;
      map.set(b.staff_id, (map.get(b.staff_id) ?? 0) + mins);
    }
    return map;
  }, [appointments, serviceById]);

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
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {staffList.map((em) => {
                const st = byStaff.get(em.id) ?? { count: 0, revenueCents: 0 };
                return (
                  <tr key={em.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-white">{em.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{st.count}</td>
                    <td className="px-4 py-3 text-zinc-400">{eurFromCents(st.revenueCents)}</td>
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
              {staffList.map((em) => {
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
            const sv = serviceById.get(id);
            return (
              <li key={id} className="flex justify-between text-sm text-zinc-300">
                <span>{sv?.name || t("analytics.unknownService", { id })}</span>
                <span className="text-zinc-500">{t("analytics.bookingsCount", { count })}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
