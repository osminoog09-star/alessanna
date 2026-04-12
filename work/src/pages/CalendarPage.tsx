import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { addDays, format, startOfDay, startOfWeek, endOfWeek, isSameDay, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import {
  buildSlotsForDay,
  bookingsForEmployeeOnDay,
  formatSlotRange,
  type Slot,
} from "../lib/slots";
import type { BookingRow, EmployeeRow, EmployeeServiceRow, ScheduleRow, ServiceRow } from "../types/database";
import { employeesEligibleForService, hasStaffRole, normalizeEmployeeRow } from "../lib/roles";
import { BookingModal } from "../components/BookingModal";
import { ProCalendar } from "../components/calendar/ProCalendar";

type View = "day" | "week";

export function CalendarPage() {
  const { t } = useTranslation();
  const { employee, canManage, isStaffOnly } = useAuth();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [employeeServiceLinks, setEmployeeServiceLinks] = useState<EmployeeServiceRow[]>([]);
  const [calendarServiceId, setCalendarServiceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ start: Date; empId: number } | null>(null);
  const [durationMin, setDurationMin] = useState(60);

  const load = useCallback(async () => {
    const [em, sch, bk, sv, es] = await Promise.all([
      supabase.from("employees").select("*").order("name"),
      supabase.from("schedules").select("*"),
      supabase.from("bookings").select("*").neq("status", "cancelled"),
      supabase.from("services").select("*").eq("active", true),
      supabase.from("employee_services").select("*"),
    ]);
    if (em.data) setEmployees((em.data as EmployeeRow[]).map(normalizeEmployeeRow));
    if (sch.data) setSchedules(sch.data as ScheduleRow[]);
    if (bk.data) setBookings(bk.data as BookingRow[]);
    if (es.data) setEmployeeServiceLinks(es.data as EmployeeServiceRow[]);
    if (sv.data) setServices(sv.data as ServiceRow[]);
    setLoading(false);
  }, []);

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
    () => employeesEligibleForService(employees, employeeServiceLinks, calendarServiceId),
    [employees, employeeServiceLinks, calendarServiceId]
  );

  const activeStaffForCalendar = useMemo(
    () => staffForCalendar.filter((e) => e.active),
    [staffForCalendar]
  );

  const dayViewEmployees = useMemo(() => {
    if (isStaffOnly && employee) {
      const self = employees.filter((e) => e.id === employee.id && e.active);
      return self.length ? self : employees.filter((e) => e.id === employee.id);
    }
    return staffForCalendar;
  }, [isStaffOnly, employee, employees, staffForCalendar]);

  useEffect(() => {
    if (isStaffOnly && employee) {
      setEmployeeId(employee.id);
      return;
    }
    if (!activeStaffForCalendar.length) return;
    if (employeeId == null || !activeStaffForCalendar.some((e) => e.id === employeeId)) {
      setEmployeeId(activeStaffForCalendar[0].id);
    }
  }, [activeStaffForCalendar, employee, employeeId, isStaffOnly]);

  const canUseCalendar = canManage || hasStaffRole(employee, "staff");

  const filteredBookings = useMemo(() => {
    if (isStaffOnly && employee) {
      return bookings.filter((b) => b.employee_id === employee.id);
    }
    return bookings;
  }, [bookings, employee, isStaffOnly]);

  const empSchedules = useMemo(() => {
    if (employeeId == null) return [];
    return schedules.filter((s) => s.employee_id === employeeId);
  }, [schedules, employeeId]);

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
  const days =
    view === "day"
      ? [startOfDay(cursor)]
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function slotsForDay(day: Date): Slot[] {
    if (employeeId == null) return [];
    const wd = day.getDay();
    const existing = bookingsForEmployeeOnDay(filteredBookings, employeeId, day);
    return buildSlotsForDay(day, wd, empSchedules, existing, durationMin, 30);
  }

  function bookingsBlocks(day: Date) {
    if (employeeId == null) return [];
    return filteredBookings.filter((b) => {
      if (b.employee_id !== employeeId) return false;
      try {
        return isSameDay(parseISO(b.appointment_at || b.start_at), day);
      } catch {
        return false;
      }
    });
  }

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
        {employee && !isStaffOnly && services.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("calendar.bookingService")}
            <select
              value={calendarServiceId ?? ""}
              onChange={(e) => setCalendarServiceId(Number(e.target.value))}
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
        {employee && !isStaffOnly && view === "week" && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("calendar.staff")}
            <select
              value={employeeId ?? ""}
              onChange={(e) => setEmployeeId(Number(e.target.value))}
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
          bookings={filteredBookings}
          employees={dayViewEmployees}
          services={services}
          employeeServiceLinks={employeeServiceLinks}
          startHour={9}
          endHour={18}
          onRefresh={load}
          onEmptyClick={(start, empId) => setModal({ start, empId })}
          canCreate={canUseCalendar}
          canDrag={canUseCalendar}
          lockToEmployeeId={isStaffOnly && employee ? employee.id : null}
        />
      ) : employeeId == null ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
          {days.map((day) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              slots={slotsForDay(day)}
              blocks={bookingsBlocks(day)}
              services={services}
              onBookSlot={(start) => setModal({ start, empId: employeeId })}
              canClick={canUseCalendar}
            />
          ))}
        </div>
      )}

      {canManage && (
        <ScheduleApprovals
          schedules={schedules}
          employees={employees}
          onChanged={load}
        />
      )}

      {isStaffOnly && employee && (
        <EmployeeScheduleProposal
          employeeId={employee.id}
          schedules={schedules}
          onChanged={load}
        />
      )}

      {modal && (
        <BookingModal
          open
          variant="pro"
          onClose={() => setModal(null)}
          onSaved={load}
          initialStart={modal.start}
          initialEmployeeId={modal.empId}
          employees={employees}
          services={services}
          links={employeeServiceLinks}
          lockEmployee={!canManage}
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
  blocks: BookingRow[];
  services: ServiceRow[];
  onBookSlot: (d: Date) => void;
  canClick: boolean;
}) {
  const { t } = useTranslation();
  const wd = String(day.getDay()) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
  return (
    <div className="flex min-h-[320px] flex-col rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-2 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t(`weekday.${wd}`)}
        </p>
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
                {format(parseISO(b.appointment_at || b.start_at), "HH:mm")} ·{" "}
                {svc?.name_et ?? t("common.service")}
              </p>
            </div>
          );
        })}
        <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
          {t("calendar.freeSlots")}
        </p>
        {slots.length === 0 && (
          <p className="text-xs text-zinc-600">{t("calendar.noWorkingHours")}</p>
        )}
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

function ScheduleApprovals({
  schedules,
  employees,
  onChanged,
}: {
  schedules: ScheduleRow[];
  employees: EmployeeRow[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const pending = schedules.filter((s) => s.status === "pending");

  async function approve(id: number) {
    await supabase.from("schedules").update({ status: "approved" }).eq("id", id);
    onChanged();
  }

  async function reject(id: number) {
    await supabase.from("schedules").delete().eq("id", id);
    onChanged();
  }

  if (!pending.length) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-sm font-semibold text-white">{t("calendar.scheduleApprovals")}</h2>
      <ul className="mt-3 space-y-2">
        {pending.map((s) => {
          const em = employees.find((e) => e.id === s.employee_id);
          const dKey = String(s.day) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm"
            >
              <span className="text-zinc-300">
                {em?.name ?? t("common.staff")} · {t(`weekday.${dKey}`)} {s.start_time.slice(0, 5)}–
                {s.end_time.slice(0, 5)}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void approve(s.id)}
                  className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                >
                  {t("calendar.approve")}
                </button>
                <button
                  type="button"
                  onClick={() => void reject(s.id)}
                  className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  {t("calendar.reject")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EmployeeScheduleProposal({
  employeeId,
  schedules,
  onChanged,
}: {
  employeeId: number;
  schedules: ScheduleRow[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [day, setDay] = useState(1);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");

  const dayOptions = [1, 2, 3, 4, 5, 6, 0] as const;

  async function propose(e: FormEvent) {
    e.preventDefault();
    await supabase.from("schedules").insert({
      employee_id: employeeId,
      day,
      start_time: start.length === 5 ? start + ":00" : start,
      end_time: end.length === 5 ? end + ":00" : end,
      status: "pending",
    });
    onChanged();
  }

  const mine = schedules.filter((s) => s.employee_id === employeeId);

  function statusLabel(status: string) {
    if (status === "approved") return t("calendar.statusApproved");
    if (status === "pending") return t("calendar.statusPending");
    return status;
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-sm font-semibold text-white">{t("calendar.myScheduleRequests")}</h2>
      <form onSubmit={propose} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-500">
          {t("calendar.dayLabel")}
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="mt-1 block rounded border border-zinc-700 bg-black px-2 py-1 text-sm text-white"
          >
            {dayOptions.map((v) => {
              const k = String(v) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
              return (
                <option key={v} value={v}>
                  {t(`weekday.${k}`)}
                </option>
              );
            })}
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          {t("calendar.from")}
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 block rounded border border-zinc-700 bg-black px-2 py-1 text-sm text-white"
          />
        </label>
        <label className="text-xs text-zinc-500">
          {t("calendar.to")}
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 block rounded border border-zinc-700 bg-black px-2 py-1 text-sm text-white"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700"
        >
          {t("calendar.submitRequest")}
        </button>
      </form>
      <ul className="mt-3 text-xs text-zinc-500">
        {mine.map((s) => {
          const dk = String(s.day) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
          return (
            <li key={s.id}>
              {t(`weekday.${dk}`)} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} ·{" "}
              {statusLabel(s.status)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
