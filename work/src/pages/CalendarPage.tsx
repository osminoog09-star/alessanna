import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, startOfDay, startOfWeek, endOfWeek, isSameDay, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import {
  buildSlotsForDay,
  appointmentsForStaffOnDay,
  formatSlotRange,
  type Slot,
} from "../lib/slots";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffScheduleRow,
  StaffServiceRow,
  StaffTimeOffRow,
} from "../types/database";
import { isStaffRowAdmin, staffEligibleForService, hasStaffRole, normalizeStaffMember } from "../lib/roles";
import { effectiveCanWorkCalendar } from "../lib/effectiveRole";
import { BookingModal } from "../components/BookingModal";
import { ProCalendar } from "../components/calendar/ProCalendar";

type View = "day" | "week";

export function CalendarPage() {
  const { t } = useTranslation();
  const { staffMember } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  /* `ServiceRow.id` — `string | number` (UUID или bigint), поэтому держим
   *  оба варианта; раньше был `number | null` и падал на UUID-ID. */
  const [calendarServiceId, setCalendarServiceId] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ start: Date; staffId: string } | null>(null);
  const [durationMin, setDurationMin] = useState(60);

  const load = useCallback(async () => {
    let apQuery = supabase.from("appointments").select("*").neq("status", "cancelled");
    if (isWorkerOnlyEffective && staffMember) {
      apQuery = apQuery.eq("staff_id", staffMember.id);
    }
    const [st, sch, to, ap, sv, ss] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
      apQuery,
      supabase.from("services").select("*").eq("active", true),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.data) {
      /* Тех-поддержка (роль admin) не принимает клиентов — не занимает колонку в календаре. */
      setStaff(
        (st.data as Record<string, unknown>[])
          .filter((row) => !isStaffRowAdmin(row))
          .map((r) => normalizeStaffMember(r as StaffMember))
      );
    }
    if (sch.data) setSchedules(sch.data as StaffScheduleRow[]);
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (ss.data) setStaffServiceLinks(ss.data as StaffServiceRow[]);
    if (sv.data) setServices(sv.data as ServiceRow[]);
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

  useEffect(() => {
    const s = services.find((x) => x.id === calendarServiceId);
    if (s) setDurationMin(s.duration_min);
  }, [calendarServiceId, services]);

  const staffForCalendar = useMemo(
    () => staffEligibleForService(staff, staffServiceLinks, calendarServiceId),
    [staff, staffServiceLinks, calendarServiceId]
  );

  const activeStaffForCalendar = useMemo(
    () => staffForCalendar.filter((e) => e.active),
    [staffForCalendar]
  );

  const dayViewStaff = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      const self = staff.filter((e) => e.id === staffMember.id && e.active);
      return self.length ? self : staff.filter((e) => e.id === staffMember.id);
    }
    return staffForCalendar;
  }, [isWorkerOnlyEffective, staffMember, staff, staffForCalendar]);

  useEffect(() => {
    if (isWorkerOnlyEffective && staffMember) {
      setStaffId(staffMember.id);
      return;
    }
    if (!activeStaffForCalendar.length) return;
    const selfInRoster =
      staffMember &&
      (hasStaffRole(staffMember, "manager") || hasStaffRole(staffMember, "admin")) &&
      activeStaffForCalendar.some((e) => e.id === staffMember.id);
    if (selfInRoster && (staffId == null || !activeStaffForCalendar.some((e) => e.id === staffId))) {
      setStaffId(staffMember!.id);
      return;
    }
    if (staffId == null || !activeStaffForCalendar.some((e) => e.id === staffId)) {
      setStaffId(activeStaffForCalendar[0].id);
    }
  }, [activeStaffForCalendar, staffMember, staffId, isWorkerOnlyEffective]);

  const canUseCalendar = staffMember ? effectiveCanWorkCalendar(staffMember.roles) : false;

  const filteredAppointments = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      return appointments.filter((b) => b.staff_id === staffMember.id);
    }
    return appointments;
  }, [appointments, staffMember, isWorkerOnlyEffective]);

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
  const days =
    view === "day"
      ? [startOfDay(cursor)]
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function slotsForDay(day: Date): Slot[] {
    if (staffId == null) return [];
    const wd = day.getDay();
    const existing = appointmentsForStaffOnDay(filteredAppointments, staffId, day);
    const sched = schedules
      .filter((s) => s.staff_id === staffId)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }));
    return buildSlotsForDay(day, wd, sched, existing, durationMin, 30);
  }

  function appointmentBlocks(day: Date) {
    if (staffId == null) return [];
    return filteredAppointments.filter((b) => {
      if (b.staff_id !== staffId) return false;
      try {
        return isSameDay(parseISO(b.start_time), day);
      } catch {
        return false;
      }
    });
  }

  const timeOffForDayView = useMemo(() => {
    if (view !== "day") return timeOff;
    const d0 = startOfDay(cursor);
    return timeOff.filter((t) => {
      try {
        const a = parseISO(t.start_time);
        const b = parseISO(t.end_time);
        return isSameDay(a, d0) || isSameDay(b, d0) || (a <= d0 && b >= d0);
      } catch {
        return false;
      }
    });
  }, [timeOff, view, cursor]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("calendar.title")}</h1>
          <p className="text-sm text-zinc-500">{t("calendar.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 p-0.5">
            <button
              type="button"
              onClick={() => setView("day")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "day" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t("calendar.day")}
            </button>
            <button
              type="button"
              onClick={() => setView("week")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "week" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t("calendar.week")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCursor(addDays(cursor, view === "day" ? -1 : -7))}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => setCursor(addDays(cursor, view === "day" ? 1 : 7))}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            →
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {staffMember && !isWorkerOnlyEffective && services.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("calendar.bookingService")}
            <select
              value={calendarServiceId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                const n = Number(v);
                setCalendarServiceId(Number.isFinite(n) && String(n) === v ? n : v);
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_et}
                </option>
              ))}
            </select>
          </label>
        )}
        {staffMember && !isWorkerOnlyEffective && view === "week" && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("calendar.staff")}
            <select
              value={staffId ?? ""}
              onChange={(e) => setStaffId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            >
              {activeStaffForCalendar.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          {t("calendar.slotLength")}
          <select
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
          >
            {[30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} {t("common.min")}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-zinc-600">
          {view === "week"
            ? `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`
            : format(cursor, "EEEE d MMMM yyyy")}
        </span>
      </div>

      {loading ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : view === "day" ? (
        <ProCalendar
          day={startOfDay(cursor)}
          appointments={filteredAppointments}
          staff={dayViewStaff}
          services={services}
          staffServiceLinks={staffServiceLinks}
          schedules={schedules}
          timeOff={timeOffForDayView}
          startHour={9}
          endHour={18}
          onRefresh={load}
          onEmptyClick={(start, sid) => setModal({ start, staffId: sid })}
          canCreate={canUseCalendar}
          canDrag={canUseCalendar}
          lockToStaffId={isWorkerOnlyEffective && staffMember ? staffMember.id : null}
        />
      ) : staffId == null ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
          {days.map((day) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              slots={slotsForDay(day)}
              blocks={appointmentBlocks(day)}
              services={services}
              onBookSlot={(start) => setModal({ start, staffId })}
              canClick={canUseCalendar}
            />
          ))}
        </div>
      )}

      {modal && (
        <BookingModal
          open
          variant="pro"
          onClose={() => setModal(null)}
          onSaved={load}
          initialStart={modal.start}
          initialStaffId={modal.staffId}
          staffList={staff}
          services={services}
          links={staffServiceLinks}
          lockStaff={!canManage}
        />
      )}
    </div>
  );
}

function DayColumn({
  day,
  slots,
  blocks,
  services,
  onBookSlot,
  canClick,
}: {
  day: Date;
  slots: Slot[];
  blocks: AppointmentRow[];
  services: ServiceRow[];
  onBookSlot: (d: Date) => void;
  canClick: boolean;
}) {
  const { t } = useTranslation();
  const wd = String(day.getDay()) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
  return (
    <div className="flex min-h-[320px] flex-col rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-2 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t(`weekday.${wd}`)}</p>
        <p className="text-lg font-semibold text-white">{format(day, "d")}</p>
      </div>
      <div className="max-h-[480px] flex-1 overflow-y-auto p-2">
        {blocks.map((b) => {
          const svc = services.find((s) => s.id === b.service_id);
          return (
            <div
              key={b.id}
              className="mb-1 rounded-lg border border-sky-900/50 bg-sky-950/40 px-2 py-1.5 text-xs text-sky-100"
            >
              <p className="font-medium">{b.client_name}</p>
              <p className="text-sky-200/80">
                {format(parseISO(b.start_time), "HH:mm")} · {svc?.name_et ?? t("common.service")}
              </p>
            </div>
          );
        })}
        <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
          {t("calendar.freeSlots")}
        </p>
        {slots.length === 0 && <p className="text-xs text-zinc-600">{t("calendar.noWorkingHours")}</p>}
        <div className="flex flex-col gap-1">
          {slots.map((s) => (
            <button
              key={s.start.toISOString()}
              type="button"
              disabled={!s.available || !canClick}
              onClick={() => s.available && canClick && onBookSlot(s.start)}
              className={`rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                s.available && canClick
                  ? "bg-zinc-900 text-zinc-300 hover:bg-sky-900/40 hover:text-white"
                  : "cursor-not-allowed bg-zinc-900/50 text-zinc-600 line-through"
              }`}
            >
              {formatSlotRange(s)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
