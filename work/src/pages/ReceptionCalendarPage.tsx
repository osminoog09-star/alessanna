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
import { ReceptionStaffColorSettings } from "../components/reception/ReceptionStaffColorSettings";
import { AdminDaySchedulePopup } from "../components/reception/AdminDaySchedulePopup";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffServiceRow,
  StaffTimeOffRow,
  StaffWorkDateRow,
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
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [workDates, setWorkDates] = useState<StaffWorkDateRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  const [visibleStaffIds, setVisibleStaffIds] = useState<Set<string>>(new Set());
  const [popup, setPopup] = useState<BookingPopupState | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dayPopup, setDayPopup] = useState<{ day: Date; x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [st, to, ap, svCatalog, ss, wd] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_time_off").select("*"),
      supabase.from("appointments").select("*").neq("status", "cancelled"),
      loadServicesCatalog({ activeOnly: true }),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_work_dates").select("*"),
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
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    if (wd.data) setWorkDates(wd.data as StaffWorkDateRow[]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (ss.data) setStaffServiceLinks(ss.data as StaffServiceRow[]);
    setServices(svCatalog);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useCalendarDataRealtime(load);

  const weekStart = useMemo(() => startOfWeek(cursor, { weekStartsOn: 1 }), [cursor]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

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

  function handleDayHeaderClick(day: Date, x: number, y: number) {
    setPopup(null);
    setDetail(null);
    setDayPopup({ day, x, y });
  }

  function handleDayClick(day: Date) {
    setCursor(day);
    setView("week");
  }

  function navigate(dir: 1 | -1) {
    if (view === "week") setCursor((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    else setCursor((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  const periodLabel = cursor.toLocaleString("ru-RU", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-white text-[#70757a]">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white text-[#3c4043]">
      <AppTopBar />

      {/* Top navigation */}
      <div className="flex shrink-0 items-center border-b border-[#dadce0] bg-white px-3 py-2">
        {/* Left: Today + view switcher */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-[#dadce0] px-4 py-1.5 text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
          >
            Сегодня
          </button>
          <div className="flex items-center rounded-lg border border-[#dadce0] p-0.5">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={[
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-[#e8f0fe] text-[#1a73e8]"
                    : "text-[#5f6368] hover:bg-[#f1f3f4]",
                ].join(" ")}
              >
                {v === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
        </div>

        {/* Center: prev / month-year / next */}
        <div className="flex flex-1 items-center justify-center gap-1">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label={view === "week" ? "Предыдущая неделя" : "Предыдущий месяц"}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="min-w-[160px] text-center text-lg font-normal capitalize text-[#3c4043]">
            {periodLabel}
          </span>
          <button
            onClick={() => navigate(1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label={view === "week" ? "Следующая неделя" : "Следующий месяц"}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Right: settings gear */}
        <div className="flex items-center">
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            title="Настройки цветов мастеров"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.01 7.01 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.11.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
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
            timeOff={timeOff}
            workDates={workDates}
            visibleStaffIds={visibleStaffIds}
            onSlotClick={handleSlotClick}
            onApptClick={handleApptClick}
            onDayHeaderClick={handleDayHeaderClick}
          />
        ) : (
          <ReceptionMonthView
            cursor={cursor}
            staff={staff}
            appointments={appointments}
            visibleStaffIds={visibleStaffIds}
            onDayClick={handleDayClick}
            onApptClick={handleApptClick}
          />
        )}
      </div>

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

      {dayPopup && (
        <AdminDaySchedulePopup
          day={dayPopup.day}
          anchorX={dayPopup.x}
          anchorY={dayPopup.y}
          allStaff={staff}
          workDates={workDates}
          onClose={() => setDayPopup(null)}
          onSaved={() => { void load(); }}
        />
      )}

      {showSettings && (
        <ReceptionStaffColorSettings
          staff={staff}
          onClose={() => setShowSettings(false)}
          onSaved={() => { void load(); }}
        />
      )}
    </div>
  );
}
