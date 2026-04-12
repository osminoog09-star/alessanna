import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { endOfMonth, format, parse, startOfMonth } from "date-fns";
import { supabase } from "../lib/supabase";
import { useFinanceRealtime } from "../hooks/useSalonRealtime";
import { eurFromCents } from "../lib/format";
import { listingPriceCents } from "../lib/serviceListing";
import type { ServiceListingRow, StaffTableRow, StaffWorkType } from "../types/database";

type LineRow = {
  staff_id: string;
  service_id: string;
  start_time: string;
  appointments: { status: string } | null;
};

export function FinancePage() {
  const { t } = useTranslation();
  const [monthStr, setMonthStr] = useState(() => format(new Date(), "yyyy-MM"));
  const [staff, setStaff] = useState<StaffTableRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [workDays, setWorkDays] = useState<Array<{ staff_id: string; date: string }>>([]);
  const [listings, setListings] = useState<ServiceListingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    const m = parse(monthStr, "yyyy-MM", new Date());
    if (Number.isNaN(m.getTime())) return { start: new Date(), end: new Date() };
    return { start: startOfMonth(m), end: endOfMonth(m) };
  }, [monthStr]);

  const load = useCallback(async () => {
    setLoading(true);
    const isoStart = range.start.toISOString();
    const isoEnd = range.end.toISOString();
    const [st, ln, wd, sv] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase
        .from("appointment_services")
        .select("staff_id, service_id, start_time, appointments ( status )")
        .gte("start_time", isoStart)
        .lte("start_time", isoEnd),
      supabase
        .from("staff_work_days")
        .select("staff_id, date")
        .gte("date", format(range.start, "yyyy-MM-dd"))
        .lte("date", format(range.end, "yyyy-MM-dd"))
        .eq("is_working", true),
      supabase.from("service_listings").select("*"),
    ]);
    if (st.data) setStaff(st.data as StaffTableRow[]);
    if (ln.data) setLines(ln.data as LineRow[]);
    if (wd.data) setWorkDays(wd.data as Array<{ staff_id: string; date: string }>);
    if (sv.data) setListings(sv.data as ServiceListingRow[]);
    setLoading(false);
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  useFinanceRealtime(load);

  const rows = useMemo(() => {
    const activeLines = lines.filter((l) => l.appointments && l.appointments.status !== "cancelled");
    const revenueByStaff = new Map<string, number>();
    for (const l of activeLines) {
      if (l.appointments?.status !== "confirmed") continue;
      const svc = listings.find((x) => x.id === l.service_id);
      const cents = svc ? listingPriceCents(svc) : 0;
      revenueByStaff.set(l.staff_id, (revenueByStaff.get(l.staff_id) ?? 0) + cents);
    }
    const workDayCount = new Map<string, number>();
    for (const w of workDays) {
      workDayCount.set(w.staff_id, (workDayCount.get(w.staff_id) ?? 0) + 1);
    }

    return staff.map((s) => {
      const revCents = revenueByStaff.get(s.id) ?? 0;
      const wt = (s.work_type as StaffWorkType) ?? "percentage";
      const pct = Number(s.percent_rate ?? 0);
      const rentDay = Number(s.rent_per_day ?? 0);
      const days = workDayCount.get(s.id) ?? 0;
      let staffShareCents = 0;
      let ownerShareCents = revCents;
      let rentCents = 0;
      if (wt === "rent") {
        rentCents = Math.round(rentDay * 100) * days;
        ownerShareCents = revCents;
        staffShareCents = 0;
      } else {
        staffShareCents = Math.round((revCents * pct) / 100);
        ownerShareCents = revCents - staffShareCents;
      }
      return {
        id: s.id,
        name: s.name,
        workType: wt,
        revenueCents: revCents,
        staffShareCents,
        ownerShareCents,
        workDays: days,
        rentCents,
      };
    });
  }, [staff, lines, listings, workDays]);

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("finance.title")}</h1>
          <p className="text-sm text-zinc-500">{t("finance.subtitle")}</p>
        </div>
        <label className="flex flex-col text-xs text-zinc-500">
          {t("finance.month")}
          <input
            type="month"
            value={monthStr}
            onChange={(e) => setMonthStr(e.target.value)}
            className="mt-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
          />
        </label>
      </header>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full border-collapse text-left text-sm text-zinc-200">
          <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">{t("common.staff")}</th>
              <th className="px-3 py-2">{t("adminStaff.payModel")}</th>
              <th className="px-3 py-2">{t("finance.revenue")}</th>
              <th className="px-3 py-2">{t("finance.staffShare")}</th>
              <th className="px-3 py-2">{t("finance.ownerShare")}</th>
              <th className="px-3 py-2">{t("finance.workDays")}</th>
              <th className="px-3 py-2">{t("finance.rentTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="px-3 py-2 font-medium text-white">{r.name}</td>
                <td className="px-3 py-2 text-zinc-400">
                  {r.workType === "rent" ? t("adminStaff.payRent") : t("adminStaff.payPercentage")}
                </td>
                <td className="px-3 py-2">{eurFromCents(r.revenueCents)}</td>
                <td className="px-3 py-2">{r.workType === "percentage" ? eurFromCents(r.staffShareCents) : "—"}</td>
                <td className="px-3 py-2">{eurFromCents(r.ownerShareCents)}</td>
                <td className="px-3 py-2">{r.workDays}</td>
                <td className="px-3 py-2">{r.workType === "rent" ? eurFromCents(r.rentCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">{t("finance.hint")}</p>
    </div>
  );
}
