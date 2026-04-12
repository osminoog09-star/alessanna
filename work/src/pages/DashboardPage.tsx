import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO, startOfDay, isSameDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";

type DashLine = {
  id: string;
  appointment_id: string;
  start_time: string;
  appointments: { status: string; client_name: string } | null;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const { staffMember, isReceptionMode } = useAuth();
  const { isWorkerOnlyEffective } = useEffectiveRole();
  const [lines, setLines] = useState<DashLine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase
      .from("appointment_services")
      .select("id, appointment_id, start_time, appointments ( status, client_name )")
      .order("start_time", { ascending: true });
    if (isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    const { data, error } = await q;
    if (!error && data) setLines(data as DashLine[]);
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember]);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const today = startOfDay(new Date());

  const activeLines = useMemo(
    () => lines.filter((l) => l.appointments && l.appointments.status !== "cancelled"),
    [lines]
  );

  const visitEarliest = useMemo(() => {
    const map = new Map<string, { client: string; at: Date }>();
    for (const l of activeLines) {
      try {
        const at = parseISO(l.start_time);
        if (Number.isNaN(at.getTime())) continue;
        const prev = map.get(l.appointment_id);
        if (!prev || at < prev.at) {
          map.set(l.appointment_id, { client: l.appointments?.client_name ?? "", at });
        }
      } catch {
        /* skip */
      }
    }
    return map;
  }, [activeLines]);

  const todayVisitIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of activeLines) {
      try {
        if (isSameDay(parseISO(l.start_time), today)) set.add(l.appointment_id);
      } catch {
        /* skip */
      }
    }
    return set;
  }, [activeLines, today]);

  const pendingVisitCount = useMemo(() => {
    const set = new Set<string>();
    for (const l of activeLines) {
      if (l.appointments?.status === "pending") set.add(l.appointment_id);
    }
    return set.size;
  }, [activeLines]);

  const upcoming = useMemo(() => {
    const now = new Date();
    return [...visitEarliest.entries()]
      .filter(([, v]) => v.at >= now)
      .sort((a, b) => a[1].at.getTime() - b[1].at.getTime())
      .slice(0, 8)
      .map(([appointmentId, v]) => ({ appointmentId, ...v }));
  }, [visitEarliest]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("dashboard.title")}</h1>
        <p className="text-sm text-zinc-500">
          {isReceptionMode ? t("reception.dashboardSubtitle") : t("dashboard.subtitle")}
        </p>
      </header>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.today")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">{todayVisitIds.size}</p>
              <p className="text-sm text-zinc-500">{t("common.bookings")}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.pipeline")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">{pendingVisitCount}</p>
              <p className="text-sm text-zinc-500">{t("dashboard.pending")}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.upcoming")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">{upcoming.length}</p>
              <p className="text-sm text-zinc-500">{t("dashboard.nextSlots")}</p>
            </div>
          </div>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">{t("dashboard.upcomingSection")}</h2>
            </div>
            <ul className="divide-y divide-zinc-800">
              {upcoming.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-zinc-500">
                  {t("dashboard.noUpcoming")}
                </li>
              )}
              {upcoming.map((b) => (
                <li
                  key={b.appointmentId}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <span className="font-medium text-zinc-200">{b.client}</span>
                  <span className="text-zinc-500">{format(b.at, "EEE d MMM HH:mm")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
