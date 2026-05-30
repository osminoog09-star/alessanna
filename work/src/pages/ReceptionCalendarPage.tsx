import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addMonths, addWeeks, startOfWeek, subMonths, subWeeks } from "date-fns";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import { isStaffRowAdmin, normalizeStaffMember } from "../lib/roles";
import { AppTopBar } from "../components/AppTopBar";
import { ReceptionSidebar } from "../components/reception/ReceptionSidebar";
import { ReceptionWeekGrid } from "../components/reception/ReceptionWeekGrid";
import { ReceptionMonthView } from "../components/reception/ReceptionMonthView";
import { ReceptionBookingPopup } from "../components/reception/ReceptionBookingPopup";
import { ReceptionAppointmentDetail } from "../components/reception/ReceptionAppointmentDetail";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffScheduleRow,
  StaffServiceRow,
  StaffTimeOffRow,
} from "../types/database";

type View = "week" | "month";

type BookingPopupState = {
  anchorX: number;
  anchorY: number;
  initialStart: Date;
  defaultStaffId: string | null;
};

type DetailState = {
  appt: AppointmentRow;
  anchorX: number;
  anchorY: number;
};

export function ReceptionCalendarPage() {
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  const [visibleStaffIds, setVisibleStaffIds] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<BookingPopupState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
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
    setDetail(null);
    setPopup({ anchorX, anchorY, initialStart: start, defaultStaffId: null });
  }

  function handleApptClick(appt: AppointmentRow, x: number, y: number) {
    setPopup(null);
    setDetail({ appt, anchorX: x, anchorY: y });
  }

  function handleDayClick(day: Date) {
    setCursor(day);
    setView("week");
  }

  function navigate(dir: 1 | -1) {
    if (view === "week") setCursor((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    else setCursor((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  const periodLabel = cursor.toLocaleString("ru-RU", {
    month: "long",
    year: "numeric",
  });

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

      {/* Top navigation bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          onClick={() => navigate(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
          onClick={() => navigate(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          ›
        </button>
        <span className="ml-1 text-base font-medium capitalize text-zinc-200">
          {periodLabel}
        </span>
        <div className="flex-1" />

        {/* View switcher */}
        <div className="flex items-center rounded-lg border border-zinc-700 p-0.5">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                view === v
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200",
              ].join(" ")}
            >
              {v === "week" ? "Неделя" : "Месяц"}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ReceptionSidebar
          cursor={cursor}
          onDateSelect={(date) => { setCursor(date); setView("week"); }}
          staff={staff}
          visibleStaffIds={visibleStaffIds}
          onToggleStaff={handleToggleStaff}
        />

        {view === "week" ? (
          <ReceptionWeekGrid
            days={days}
            staff={staff}
            appointments={appointments}
            services={services}
            schedules={schedules}
            timeOff={timeOff}
            visibleStaffIds={visibleStaffIds}
            onSlotClick={handleSlotClick}
            onApptClick={handleApptClick}
          />
        ) : (
          <ReceptionMonthView
            cursor={cursor}
            staff={staff}
            appointments={appointments}
            services={services}
            visibleStaffIds={visibleStaffIds}
            onDayClick={handleDayClick}
            onApptClick={handleApptClick}
          />
        )}
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

      {/* Appointment detail */}
      {detail && (
        <ReceptionAppointmentDetail
          appt={detail.appt}
          anchorX={detail.anchorX}
          anchorY={detail.anchorY}
          staff={staff}
          services={services}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
