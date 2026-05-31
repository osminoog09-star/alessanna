import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  format,
  startOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  setHours,
  setMinutes,
} from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffScheduleRow,
  StaffServiceRow,
  StaffTimeOffRow,
  StaffWorkDateRow,
} from "../types/database";
import { isStaffRowAdmin, normalizeStaffMember } from "../lib/roles";
import { effectiveCanWorkCalendar } from "../lib/effectiveRole";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import {
  serviceRowToPublicCatalogEntry,
  splitStaffIntoHairAndNailsForCrm,
} from "../lib/publicMasterPanel";
import {
  DEFAULT_RECEPTION_MASTERS_PANEL,
  loadReceptionLayoutStore,
  type ReceptionMastersPanelConfig,
} from "../lib/receptionLayout";
import { fetchReceptionLayoutFromServer } from "../lib/receptionLayoutRemote";
import { BookingModal } from "../components/BookingModal";
import { ReceptionWeekGrid } from "../components/reception/ReceptionWeekGrid";
import { AdminDaySchedulePopup } from "../components/reception/AdminDaySchedulePopup";
import { buildStaffHueMap } from "../lib/staffHue";
import { staffCrmAppointmentBlockStyle } from "../lib/staffCalendarColors";
import { generateAvailableSlots } from "../lib/slots";

type View = "week" | "month";

export function CalendarPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [workDates, setWorkDates] = useState<StaffWorkDateRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  const [calendarServiceId, setCalendarServiceId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ start: Date; staffId: string; editAppt?: AppointmentRow | null } | null>(null);
  const [dayPopup, setDayPopup] = useState<{ day: Date; x: number; y: number } | null>(null);
  const [receptionMastersConfig, setReceptionMastersConfig] = useState<ReceptionMastersPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_MASTERS_PANEL,
  }));

  const load = useCallback(async () => {
    let apQuery = supabase.from("appointments").select("*").neq("status", "cancelled");
    if (isWorkerOnlyEffective && staffMember) {
      apQuery = apQuery.eq("staff_id", staffMember.id);
    }
    const [st, sch, to, ap, svCatalog, ss, remoteLayout, wd] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
      apQuery,
      loadServicesCatalog({ activeOnly: true }),
      supabase.from("staff_services").select("*"),
      fetchReceptionLayoutFromServer(),
      supabase.from("staff_work_dates").select("*"),
    ]);
    if (st.data) {
      const normalized = (st.data as Record<string, unknown>[])
        .filter((row) => !isStaffRowAdmin(row))
        .map((r) => normalizeStaffMember(r as StaffMember));
      setStaff(normalized);
    }
    if (sch.data) setSchedules(sch.data as StaffScheduleRow[]);
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    if (wd.data) setWorkDates(wd.data as StaffWorkDateRow[]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (ss.data) setStaffServiceLinks(ss.data as StaffServiceRow[]);
    setServices(svCatalog);
    if (remoteLayout) {
      setReceptionMastersConfig(remoteLayout.masters);
    } else {
      setReceptionMastersConfig(loadReceptionLayoutStore().masters);
    }
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember]);

  useEffect(() => {
    void load();
  }, [load]);

  useCalendarDataRealtime(load);

  useEffect(() => {
    if (calendarServiceId == null && services.length > 0) {
      setCalendarServiceId(services[0].id);
    }
  }, [services, calendarServiceId]);

  const durationMin = useMemo(() => {
    const s = services.find((x) => x.id === calendarServiceId);
    return Math.max(15, s?.duration_min ?? 60);
  }, [calendarServiceId, services]);

  const servicesCatalog = useMemo(
    () => services.map((s) => serviceRowToPublicCatalogEntry(s)!),
    [services],
  );

  const mastersPanelStaffForHall = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staff.map((m) => [m.id, m]));
      const ids = [
        ...new Set([...receptionMastersConfig.hairStaffIds, ...receptionMastersConfig.nailsStaffIds]),
      ];
      return ids.map((id) => byId.get(id)).filter((m): m is StaffMember => m != null);
    }
    return staff;
  }, [receptionMastersConfig, staff]);

  const mastersSplitResolved = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staff.map((m) => [m.id, m]));
      const pick = (ids: string[]) =>
        ids.map((id) => byId.get(id)).filter((m): m is StaffMember => m != null);
      return {
        hair: pick(receptionMastersConfig.hairStaffIds),
        nails: pick(receptionMastersConfig.nailsStaffIds),
      };
    }
    return splitStaffIntoHairAndNailsForCrm(staff, staffServiceLinks, servicesCatalog);
  }, [receptionMastersConfig, staff, staffServiceLinks, servicesCatalog]);

  /* The reception-style calendar shows every active master (colour-coded
   * columns + day-header chips). No per-service filtering here — that was
   * for the old single-staff dropdown which this view replaced. */
  const activeStaffForCalendar = useMemo(
    () => staff.filter((e) => e.active !== false),
    [staff],
  );

  const canUseCalendar = staffMember ? effectiveCanWorkCalendar(staffMember.roles) : false;

  const filteredAppointments = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      return appointments.filter((b) => b.staff_id === staffMember.id);
    }
    return appointments;
  }, [appointments, staffMember, isWorkerOnlyEffective]);

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const monthGridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: monthGridStart, end: monthGridEnd });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function appointmentBlocks(day: Date) {
    return filteredAppointments.filter((b) => {
      try {
        return isSameDay(parseISO(b.start_time), day);
      } catch {
        return false;
      }
    });
  }

  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  const monthMasterAvailability = useMemo(() => {
    const out = new Map<string, { free: number; working: number; fullyClosed: boolean }>();
    if (view !== "month") return out;
    const pool = activeStaffForCalendar;
    for (const d of monthDays) {
      const weekday = d.getDay();
      const key = format(d, "yyyy-MM-dd");
      let working = 0;
      let free = 0;
      for (const member of pool) {
        const memberSchedule = schedules
          .filter((s) => s.staff_id === member.id && s.day_of_week === weekday)
          .map((s) => ({
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
          }));
        if (!memberSchedule.length) continue;
        working++;
        const slots = generateAvailableSlots({
          schedule: memberSchedule,
          appointments: filteredAppointments,
          timeOff,
          duration: durationMin,
          day: d,
          stepMinutes: 15,
          staffId: member.id,
        });
        if (slots.length > 0) free++;
      }
      out.set(key, {
        free,
        working,
        fullyClosed: working > 0 && free === 0,
      });
    }
    return out;
  }, [activeStaffForCalendar, durationMin, filteredAppointments, monthDays, schedules, timeOff, view]);

  /* No sidebar toggle in this view — show every active master (workers
   * still only see their own column). */
  const effectiveVisibleIds = useMemo(
    () =>
      isWorkerOnlyEffective && staffMember
        ? new Set([staffMember.id])
        : new Set(activeStaffForCalendar.map((m) => m.id)),
    [isWorkerOnlyEffective, staffMember, activeStaffForCalendar],
  );

  function navigate(dir: 1 | -1) {
    setCursor((d) => view === "week" ? addDays(d, dir * 7) : addMonths(d, dir));
  }

  const periodLabel = cursor.toLocaleString("ru-RU", { month: "long", year: "numeric" });

  function openQuickBooking() {
    if (!canUseCalendar) return;
    const sid = isWorkerOnlyEffective && staffMember
      ? staffMember.id
      : [...effectiveVisibleIds][0] ?? activeStaffForCalendar[0]?.id;
    if (!sid) return;
    const base = startOfDay(cursor);
    const now = new Date();
    const sameDay = isSameDay(base, now);
    const hour = sameDay ? now.getHours() : 10;
    const mins = sameDay ? (now.getMinutes() <= 30 ? 30 : 0) : 0;
    const start = setMinutes(setHours(base, hour), mins);
    setModal({ start, staffId: sid });
  }

  return (
    <div className="flex flex-col gap-3 text-fg">
      {/* Top navigation */}
      <div className="flex shrink-0 items-center rounded-xl border border-line/15 bg-panel px-3 py-2">
        {/* Left: Today + view switcher */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-line/15 px-4 py-1.5 text-sm font-medium text-fg hover:bg-surface/80"
          >
            Сегодня
          </button>
          <div className="flex items-center rounded-lg border border-line/15 p-0.5">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={[
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  view === v ? "bg-surface text-fg" : "text-muted hover:bg-surface/50",
                ].join(" ")}
              >
                {v === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
        </div>

        {/* Center: prev / period / next */}
        <div className="flex flex-1 items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface/60"
            aria-label={view === "week" ? "Предыдущая неделя" : "Предыдущий месяц"}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="min-w-[160px] text-center text-lg font-normal capitalize text-fg">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => navigate(1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface/60"
            aria-label={view === "week" ? "Следующая неделя" : "Следующий месяц"}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Right: create booking */}
        <div className="flex items-center">
          {canUseCalendar && (
            <button
              type="button"
              onClick={openQuickBooking}
              className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-1.5 text-sm font-medium text-gold hover:bg-gold/15"
            >
              + {t("calendar.createBooking", { defaultValue: "Запись" })}
            </button>
          )}
        </div>
      </div>

      {/* Main body — a contained, smaller window that scrolls internally
          (the calendar body scrolls, not the whole page). */}
      <div className="flex h-[72vh] min-h-0 overflow-hidden rounded-xl border border-line/15 bg-panel">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted">
              {t("common.loading")}
            </div>
          ) : view === "week" ? (
            <ReceptionWeekGrid
              dark
              days={days}
              staff={activeStaffForCalendar}
              appointments={filteredAppointments}
              services={services}
              timeOff={timeOff}
              workDates={workDates}
              visibleStaffIds={effectiveVisibleIds}
              onSlotClick={(start) => {
                if (!canUseCalendar) return;
                const sid = isWorkerOnlyEffective && staffMember
                  ? staffMember.id
                  : [...effectiveVisibleIds][0] ?? activeStaffForCalendar[0]?.id;
                if (sid) setModal({ start, staffId: sid });
              }}
              onApptClick={(appt) => {
                if (!canUseCalendar) return;
                setModal({ start: parseISO(appt.start_time), staffId: appt.staff_id, editAppt: appt });
              }}
              onDayHeaderClick={canManage ? (day, x, y) => setDayPopup({ day, x, y }) : undefined}
            />
          ) : (
            <div className="flex-1 overflow-auto p-4">
              <div className="overflow-hidden rounded-xl border border-line/10 bg-line/5">
                <div className="grid grid-cols-7 border-b border-line/10 bg-panel">
                  {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                    <div key={d} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {monthDays.map((day, idx) => {
                    const blocks = appointmentBlocks(day);
                    const inCurrentMonth = day >= monthStart && day <= monthEnd;
                    const availability = monthMasterAvailability.get(format(day, "yyyy-MM-dd"));
                    const isToday = isSameDay(day, new Date());
                    const colPos = idx % 7;
                    return (
                      <div
                        key={day.toISOString()}
                        className={[
                          "min-h-[100px] bg-panel p-2 transition hover:bg-surface/40",
                          colPos < 6 ? "border-r border-line/10" : "",
                          idx < monthDays.length - 7 ? "border-b border-line/10" : "",
                          inCurrentMonth ? "" : "opacity-40",
                        ].join(" ")}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                              isToday ? "bg-[#1a73e8] text-white" : "text-fg"
                            }`}
                          >
                            {format(day, "d")}
                          </span>
                          {availability && availability.working > 0 && (
                            <span className={`text-[10px] ${availability.fullyClosed ? "text-rose-300" : "text-muted"}`}>
                              {availability.fullyClosed ? "×" : `${availability.free}/${availability.working}`}
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          {blocks.slice(0, 3).map((b) => {
                            const svc = services.find((s) => s.id === b.service_id);
                            return (
                              <div
                                key={b.id}
                                className="truncate rounded px-1 py-0.5 text-[10px]"
                                style={staffCrmAppointmentBlockStyle(b.staff_id, staff, staffHueMap)}
                              >
                                <span className="font-medium">{format(parseISO(b.start_time), "HH:mm")}</span>
                                {" "}{b.client_name}
                                {svc && <span className="opacity-70"> · {svc.name_et}</span>}
                              </div>
                            );
                          })}
                          {blocks.length > 3 && (
                            <p className="text-[10px] text-muted">+{blocks.length - 3}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <BookingModal
          open
          variant="pro"
          layout="modal"
          onClose={() => setModal(null)}
          onSaved={load}
          initialStart={modal.start}
          initialStaffId={modal.staffId}
          staffList={staff}
          services={services}
          links={staffServiceLinks}
          lockStaff={!canManage}
          mastersHallSplit={mastersSplitResolved}
          mastersHallFullPanel={mastersPanelStaffForHall}
          editAppointment={modal.editAppt ?? null}
        />
      )}

      {dayPopup && (
        <AdminDaySchedulePopup
          day={dayPopup.day}
          anchorX={dayPopup.x}
          anchorY={dayPopup.y}
          allStaff={activeStaffForCalendar}
          workDates={workDates}
          onClose={() => setDayPopup(null)}
          onSaved={() => { void load(); }}
        />
      )}
    </div>
  );
}
