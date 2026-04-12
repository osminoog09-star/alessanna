import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isBefore, parseISO, startOfDay, subDays } from "date-fns";
import { supabase } from "../lib/supabase";
import { useAnalyticsRealtime } from "../hooks/useSalonRealtime";
import { eurFromCents } from "../lib/format";
import { listingPriceCents, listingSlotMinutes } from "../lib/serviceListing";
import type { ServiceListingRow } from "../types/database";

type StaffRow = { id: string; name: string };

type LineRow = {
  staff_id: string;
  service_id: string;
  start_time: string;
  appointments: { status: string } | null;
};

export function AnalyticsPage() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<LineRow[]>([]);
  const [staffList, setStaffList] = useState<StaffRow[]>([]);
  const [listings, setListings] = useState<ServiceListingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [b, e, s] = await Promise.all([
      supabase.from("appointment_services").select(`
        staff_id, service_id, start_time,
        appointments ( status )
      `),
      supabase.from("staff").select("id,name").order("name"),
      supabase.from("service_listings").select("*"),
    ]);
    if (b.data) setLines(b.data as LineRow[]);
    if (e.data) setStaffList(e.data as StaffRow[]);
    if (s.data) setListings(s.data as ServiceListingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useAnalyticsRealtime(load);

  const activeLines = useMemo(
    () => lines.filter((l) => l.appointments && l.appointments.status !== "cancelled"),
    [lines]
  );

  const byStaff = useMemo(() => {
    const map = new Map<string, { count: number; revenueCents: number }>();
    for (const b of activeLines) {
      const st = b.appointments?.status;
      const svc = listings.find((x) => x.id === b.service_id);
      const cents = svc ? listingPriceCents(svc) : 0;
      const cur = map.get(b.staff_id) ?? { count: 0, revenueCents: 0 };
      cur.count += 1;
      if (st === "confirmed") {
        cur.revenueCents += cents;
      }
      map.set(b.staff_id, cur);
    }
    return map;
  }, [activeLines, listings]);

  const popularServices = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of activeLines) {
      map.set(b.service_id, (map.get(b.service_id) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, c) => c[1] - a[1])
      .slice(0, 10);
  }, [activeLines]);

  const utilization30d = useMemo(() => {
    const since = startOfDay(subDays(new Date(), 30));
    const map = new Map<string, number>();
    for (const b of activeLines) {
      try {
        const at = parseISO(b.start_time);
        if (isBefore(at, since)) continue;
      } catch {
        continue;
      }
      const svc = listings.find((x) => x.id === b.service_id);
      const mins = svc ? listingSlotMinutes(svc) : 60;
      map.set(b.staff_id, (map.get(b.staff_id) ?? 0) + mins);
    }
    return map;
  }, [activeLines, listings]);

  /** Crude benchmark: 8h/day × 30 days (not tied to real staff_schedule). */
  const capacity30dMin = 30 * 8 * 60;

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("analytics.title")}</h1>
        <p className="text-sm text-zinc-500">{t("analytics.subtitle")}</p>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-white">{t("analytics.revenueByStaff")}</h2>
        <p className="mt-1 text-xs text-zinc-600">{t("analytics.revenueNote")}</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">{t("analytics.colStaff")}</th>
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
                <th className="px-4 py-3">{t("analytics.colStaff")}</th>
                <th className="px-4 py-3">{t("analytics.colBookedMinutes")}</th>
                <th className="px-4 py-3">{t("analytics.colLoadApprox")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {staffList.map((em) => {
                const mins = utilization30d.get(em.id) ?? 0;
                const loadPct = Math.min(100, Math.round((mins / capacity30dMin) * 100));
                return (
                  <tr key={em.id} className="bg-zinc-950/80">
                    <td className="px-4 py-3 text-white">{em.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{mins}</td>
                    <td className="px-4 py-3 text-zinc-400">{loadPct}%</td>
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
            const sv = listings.find((s) => s.id === id);
            return (
              <li key={id} className="flex justify-between text-sm text-zinc-300">
                <span>{sv?.name ?? t("analytics.unknownService", { id })}</span>
                <span className="text-zinc-500">{t("analytics.bookingsCount", { count })}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
