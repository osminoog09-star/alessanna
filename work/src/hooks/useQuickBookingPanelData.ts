import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { salonDayStartUtc } from "../lib/bookingSalonTz";
import type { AppointmentRow } from "../types/database";

export type QuickPanelTimeOff = { staff_id: string; start_time: string; end_time: string };

/**
 * Загрузка записей и выходов за [fromYmd, toYmd] включительно (календарь салона).
 * Для нижней панели Quick Booking — одна выборка на весь видимый диапазон.
 */
export function useQuickBookingPanelData(
  staffIds: string[],
  fromYmd: string,
  toYmd: string,
): {
  appointments: AppointmentRow[];
  timeOff: QuickPanelTimeOff[];
  ready: boolean;
  error: string | null;
  reloadKey: number;
  bumpReload: () => void;
} {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [timeOff, setTimeOff] = useState<QuickPanelTimeOff[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const bumpReload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!isSupabaseConfigured() || staffIds.length === 0) {
      setAppointments([]);
      setTimeOff([]);
      setReady(true);
      setError(null);
      return;
    }

    let cancelled = false;
    setReady(false);
    setError(null);

    const startUtc = salonDayStartUtc(fromYmd);
    const endUtc = new Date(salonDayStartUtc(toYmd).getTime() + 24 * 60 * 60 * 1000);

    void (async () => {
      const [ap, to] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .in("staff_id", staffIds)
          .gte("start_time", startUtc.toISOString())
          .lt("start_time", endUtc.toISOString())
          .neq("status", "cancelled"),
        supabase
          .from("staff_time_off")
          .select("*")
          .in("staff_id", staffIds)
          .lt("start_time", endUtc.toISOString())
          .gt("end_time", startUtc.toISOString()),
      ]);

      if (cancelled) return;

      if (ap.error) {
        setError(ap.error.message);
        setAppointments([]);
      } else {
        setAppointments((ap.data ?? []) as AppointmentRow[]);
      }

      if (to.error) {
        setError(to.error.message);
        setTimeOff([]);
      } else {
        setTimeOff(
          (to.data ?? []) as Array<{ staff_id: string; start_time: string; end_time: string }>,
        );
      }

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [staffIds.join(","), fromYmd, toYmd, reloadKey]);

  return { appointments, timeOff, ready, error, reloadKey, bumpReload };
}
