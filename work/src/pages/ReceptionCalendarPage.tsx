import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, startOfWeek, subWeeks } from "date-fns";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import { isStaffRowAdmin, normalizeStaffMember } from "../lib/roles";
import { AppTopBar } from "../components/AppTopBar";
import { ReceptionSidebar } from "../components/reception/ReceptionSidebar";
import { ReceptionWeekGrid } from "../components/reception/ReceptionWeekGrid";
import { ReceptionBookingPopup } from "../components/reception/ReceptionBookingPopup";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffScheduleRow,
  StaffServiceRow,
  StaffTimeOffRow,
} from "../types/database";

type PopupState = {
  anchorX: number;
  anchorY: number;
  initialStart: Date;
  defaultStaffId: string | null;
};

export function ReceptionCalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  const [visibleStaffIds, setVisibleStaffIds] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [st, sch, to, ap, svCatalog, ss] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
      supabase.from("appointments").select("*").neq("status", "cancelled"),
      loadServicesCatalog({ activeOnly: true }),
      supabase.from("staff_services").select("*"),
    ]);

    if (st.data) {
      const normalized = (st.data as Record<string, unknown>[])
        .filter((row) => !isStaffRowAdmin(row))
        .map((r) => normalizeStaffMember(r as StaffMember));
      setStaff(normalized);
      // Initialize all staff as visible on first load
      setVisibleStaffIds((prev) => {
        if (prev.size > 0) return prev;
        return new Set(normalized.map((m) => m.id));
      });
    }
    if (sch.data) setSchedules(sch.data as StaffScheduleRow[]);
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (ss.data) setStaffServiceLinks(ss.data as StaffServiceRow[]);
    setServices(svCatalog);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useCalendarDataRealtime(load);

  const weekStart = useMemo(
    () => startOfWeek(cursor, { weekStartsOn: 1 }),
    [cursor],
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  function handleToggleStaff(id: string) {
    setVisibleStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSlotClick(start: Date, anchorX: number, anchorY: number) {
    setPopup({ anchorX, anchorY, initialStart: start, defaultStaffId: null });
  }

  const weekLabel = cursor.toLocaleString("ru-RU", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <AppTopBar />

      {/* Google Calendar-style top nav */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        {/* Nav buttons */}
        <button
          onClick={() => setCursor((d) => subWeeks(d, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Предыдущая неделя"
        >
          ‹
        </button>
        <button
          onClick={() => setCursor(new Date())}
          className="rounded-lg border border-zinc-700 px-3 py-1 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Сегодня
        </button>
        <button
          onClick={() => setCursor((d) => addWeeks(d, 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Следующая неделя"
        >
          ›
        </button>

        {/* Month + year label */}
        <span className="ml-1 text-base font-medium capitalize text-zinc-200">
          {weekLabel}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View badge (static for now) */}
        <span className="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1 text-sm text-zinc-300">
          Неделя
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 opacity-60" fill="currentColor">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </span>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ReceptionSidebar
          cursor={cursor}
          onDateSelect={(date) => setCursor(date)}
          staff={staff}
          visibleStaffIds={visibleStaffIds}
          onToggleStaff={handleToggleStaff}
        />

        <ReceptionWeekGrid
          days={days}
          staff={staff}
          appointments={appointments}
          services={services}
          schedules={schedules}
          timeOff={timeOff}
          visibleStaffIds={visibleStaffIds}
          onSlotClick={handleSlotClick}
        />
      </div>

      {/* Booking popup */}
      {popup && (
        <ReceptionBookingPopup
          anchorX={popup.anchorX}
          anchorY={popup.anchorY}
          initialStart={popup.initialStart}
          defaultStaffId={popup.defaultStaffId}
          staff={staff}
          services={services}
          links={staffServiceLinks}
          onSave={() => { setPopup(null); void load(); }}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
