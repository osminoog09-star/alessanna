import { useCallback, useEffect, useState } from "react";
import { format, parseISO, startOfDay, isSameDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useBookingsRealtime } from "../hooks/useSalonRealtime";
import type { BookingRow } from "../types/database";
import { useAuth } from "../context/AuthContext";
export function DashboardPage() {
  const { t } = useTranslation();
  const { employee, isStaffOnly } = useAuth();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("bookings").select("*");
    if (!error && data) setBookings(data as BookingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBookingsRealtime(load);

  const today = startOfDay(new Date());
  const mine = bookings.filter((b) => {
    if (b.status === "cancelled") return false;
    if (isStaffOnly && employee) return b.employee_id === employee.id;
    return true;
  });

  const todayBookings = mine.filter((b) => {
    const t = b.appointment_at || b.start_at;
    try {
      return isSameDay(parseISO(t), today);
    } catch {
      return false;
    }
  });

  const upcoming = mine
    .filter((b) => {
      try {
        return parseISO(b.appointment_at || b.start_at) >= new Date();
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
              <p className="mt-2 text-3xl font-semibold text-white">{todayBookings.length}</p>
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
                  <span className="text-zinc-500">
                    {format(parseISO(b.appointment_at || b.start_at), "EEE d MMM HH:mm")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
