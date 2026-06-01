import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, addMonths, addWeeks, subDays, startOfWeek, subMonths, subWeeks } from "date-fns";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import { isStaffRowAdmin, normalizeStaffMember } from "../lib/roles";
import { useTheme } from "../context/ThemeContext";
import { ReceptionSidebar } from "../components/reception/ReceptionSidebar";
import { ReceptionWeekGrid } from "../components/reception/ReceptionWeekGrid";
import { ReceptionMonthView } from "../components/reception/ReceptionMonthView";
import { ReceptionBookingPopup } from "../components/reception/ReceptionBookingPopup";
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

type View = "day" | "week" | "month";

type BookingPopupState = {
  anchorX: number;
  anchorY: number;
  initialStart: Date;
  defaultStaffId: string | null;
  editAppt?: AppointmentRow | null;
};

export function ReceptionCalendarPage() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const dark = theme === "onyx" || theme === "stone";
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
  const [showSettings, setShowSettings] = useState(false);
  const [dayPopup, setDayPopup] = useState<{ day: Date; x: number; y: number } | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
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
  const days = useMemo(() => {
    if (view === "day") return [cursor];
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [view, cursor, weekStart]);

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

  function handleApptClick(appt: AppointmentRow, x: number, y: number) {
    setPopup({
      anchorX: x,
      anchorY: y,
      initialStart: new Date(appt.start_time),
      defaultStaffId: appt.staff_id,
      editAppt: appt,
    });
  }

  async function handleApptResize(appt: AppointmentRow, newStart: Date, newEnd: Date) {
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === appt.id
          ? { ...a, start_time: newStart.toISOString(), end_time: newEnd.toISOString() }
          : a,
      ),
    );
    const { error } = await supabase
      .from("appointments")
      .update({ start_time: newStart.toISOString(), end_time: newEnd.toISOString() })
      .eq("id", appt.id);
    if (error) void load();
  }

  function handleDayHeaderClick(day: Date, x: number, y: number) {
    setPopup(null);
    setDayPopup({ day, x, y });
  }

  function handleDayClick(day: Date) {
    setCursor(day);
    setView("day");
  }

  function navigate(dir: 1 | -1) {
    if (view === "day") setCursor((d) => (dir === 1 ? addDays(d, 1) : subDays(d, 1)));
    else if (view === "week") setCursor((d) => (dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1)));
    else setCursor((d) => (dir === 1 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  const uiLocale = i18n.language === "et" ? "et-EE" : "ru-RU";
  const periodLabel = view === "day"
    ? cursor.toLocaleString(uiLocale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : cursor.toLocaleString(uiLocale, { month: "long", year: "numeric" });

  const navHover = dark ? "hover:bg-white/5" : "hover:bg-surface";
  const navText = "text-muted";
  const accentActive = dark ? "bg-gold/15 text-gold" : "bg-[#e8f0fe] text-[#1a73e8]";
  const todayBtnCls = dark
    ? "border-gold/40 text-gold hover:bg-gold/10"
    : "border-line/15 text-fg hover:bg-surface";

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-canvas text-muted">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-canvas text-fg">
      {/* Top navigation */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line/15 bg-canvas px-2 py-2">
        {/* Hamburger — mobile only */}
        <button
          onClick={() => setShowSidebar((s) => !s)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${navText} ${navHover} md:hidden`}
          aria-label="Меню"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Today */}
        <button
          onClick={() => setCursor(new Date())}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${todayBtnCls}`}
        >
          {t("calendar.today")}
        </button>

        {/* View switcher — hidden on mobile (available in sidebar) */}
        <div className="hidden items-center rounded-lg border border-line/15 p-0.5 md:flex">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                view === v ? accentActive : `text-muted ${navHover}`,
              ].join(" ")}
            >
              {v === "day" ? t("calendar.day") : v === "week" ? t("calendar.week") : t("calendar.month")}
            </button>
          ))}
        </div>

        {/* Prev / period label / Next — centered */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          <button
            onClick={() => navigate(-1)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${navText} ${navHover}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="min-w-0 truncate text-center text-base font-normal capitalize text-fg sm:text-lg">
            {periodLabel}
          </span>
          <button
            onClick={() => navigate(1)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${navText} ${navHover}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Settings gear */}
        <button
          onClick={() => setShowSettings(true)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${navText} ${navHover}`}
          title={t("reception.colorSettings")}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.01 7.01 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.11.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      </div>

      {/* Main layout */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar: always visible on md+; slide-in drawer on mobile */}
        <div
          className={[
            "absolute inset-y-0 left-0 z-40 flex flex-col transition-transform duration-200 md:relative md:translate-x-0 md:flex",
            showSidebar ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <ReceptionSidebar
            cursor={cursor}
            onDateSelect={(date) => { setCursor(date); setView("week"); setShowSidebar(false); }}
            staff={staff}
            visibleStaffIds={visibleStaffIds}
            onToggleStaff={handleToggleStaff}
            view={view}
            onViewChange={setView}
            dark={dark}
          />
        </div>

        {/* Backdrop — closes drawer when tapping outside on mobile */}
        {showSidebar && (
          <div
            className="absolute inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setShowSidebar(false)}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === "month" ? (
            <ReceptionMonthView
              cursor={cursor}
              staff={staff}
              appointments={appointments}
              visibleStaffIds={visibleStaffIds}
              onDayClick={handleDayClick}
              onApptClick={handleApptClick}
              dark={dark}
            />
          ) : (
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
              onApptResize={handleApptResize}
              onDayHeaderClick={view === "week" ? handleDayHeaderClick : undefined}
              dark={dark}
            />
          )}
        </div>
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
          editAppt={popup.editAppt ?? null}
          onSave={() => { setPopup(null); void load(); }}
          onClose={() => setPopup(null)}
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
