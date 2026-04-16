import { useCallback, useEffect, useState } from "react";
import { format, parseISO, startOfDay, isSameDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import type { AppointmentRow } from "../types/database";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";

export function DashboardPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();
  const { isWorkerOnlyEffective } = useEffectiveRole();
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from("appointments").select("*");
    if (isWorkerOnlyEffective && staffMember) {
      q = q.eq("staff_id", staffMember.id);
    }
    const { data, error } = await q;
    if (!error && data) setAppointments(data as AppointmentRow[]);
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember]);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const today = startOfDay(new Date());
  const mine = appointments.filter((b) => b.status !== "cancelled");

  const todayAppointments = mine.filter((b) => {
    try {
      return isSameDay(parseISO(b.start_time), today);
    } catch {
      return false;
    }
  });

  const upcoming = mine
    .filter((b) => {
      try {
        return parseISO(b.start_time) >= new Date();
      } catch {
        return false;
      }
    })
    .slice(0, 8);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-white">{t("dashboard.title")}</h1>
        <p className="text-sm text-zinc-500">{t("dashboard.subtitle")}</p>
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
              <p className="mt-2 text-3xl font-semibold text-white">{todayAppointments.length}</p>
              <p className="text-sm text-zinc-500">{t("common.bookings")}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("dashboard.pipeline")}
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {mine.filter((b) => b.status === "pending").length}
              </p>
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
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="font-medium text-zinc-200">{b.client_name}</span>
                  <span className="text-zinc-500">{format(parseISO(b.start_time), "EEE d MMM HH:mm")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
