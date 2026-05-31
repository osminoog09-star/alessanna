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
} from "../types/database";
import { isStaffRowAdmin, staffEligibleForService, normalizeStaffMember } from "../lib/roles";
import { effectiveCanWorkCalendar } from "../lib/effectiveRole";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import {
  restrictAndOrderStaffByServiceHall,
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
import { CalendarSidePanels } from "../components/CalendarSidePanels";
import { ProCalendar } from "../components/calendar/ProCalendar";
import { WeekTimelineGrid } from "../components/calendar/WeekTimelineGrid";
import { ReceptionWeekGrid } from "../components/reception/ReceptionWeekGrid";
import { DaySchedulePopup } from "../components/reception/DaySchedulePopup";
import { buildStaffHueMap } from "../lib/staffHue";
import {
  CALENDAR_WEEK_EXCEPT_SUNDAY_STAFF_SETTING_KEY,
  panelStaffWorkingOnDate,
  parseStaffIdJsonList,
} from "../lib/calendarWorkingStaff";
import { staffCrmAppointmentBlockStyle } from "../lib/staffCalendarColors";
import { generateAvailableSlots } from "../lib/slots";

const ALL_STAFF_ID = "__all__";

type View = "day" | "week" | "month";

export function CalendarPage() {
  const { t } = useTranslation();
  const { staffMember, isReceptionMode } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [staffId, setStaffId] = useState<string>(ALL_STAFF_ID);
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
  const [dayPopup, setDayPopup] = useState<{ day: Date; x: number; y: number } | null>(null);
  const [receptionMastersConfig, setReceptionMastersConfig] = useState<ReceptionMastersPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_MASTERS_PANEL,
  }));
  const [implicitWeekExceptSundayStaffIds, setImplicitWeekExceptSundayStaffIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    let apQuery = supabase.from("appointments").select("*").neq("status", "cancelled");
    if (isWorkerOnlyEffective && staffMember) {
      apQuery = apQuery.eq("staff_id", staffMember.id);
    }
    const [st, sch, to, ap, svCatalog, ss, remoteLayout, implicitSetting] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
      apQuery,
      /* Каталог услуг — через общий хелпер: сначала service_listings (актуальный
       * UUID-каталог, который видит сайт), при пустом — fallback на legacy
       * `services`. Без хелпера тут был блокер: если `services` пустая (а так
       * и есть после миграции 012 на новых проектах), модалка «Новая запись»
       * показывала пустой dropdown «Услуга». */
      loadServicesCatalog({ activeOnly: true }),
      supabase.from("staff_services").select("*"),
      fetchReceptionLayoutFromServer(),
      supabase.from("salon_settings").select("value").eq("key", CALENDAR_WEEK_EXCEPT_SUNDAY_STAFF_SETTING_KEY).maybeSingle(),
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
    setServices(svCatalog);
    if (remoteLayout) {
      setReceptionMastersConfig(remoteLayout.masters);
    } else {
      setReceptionMastersConfig(loadReceptionLayoutStore().masters);
    }
    setImplicitWeekExceptSundayStaffIds(
      parseStaffIdJsonList(
        implicitSetting.data?.value != null ? String(implicitSetting.data.value) : undefined,
      ),
    );
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

  const staffForCalendar = useMemo(() => {
    const base = staffEligibleForService(staff, staffServiceLinks, calendarServiceId);
    const svc = services.find((x) => x.id === calendarServiceId);
    return restrictAndOrderStaffByServiceHall(
      base,
      serviceRowToPublicCatalogEntry(svc),
      mastersSplitResolved,
      mastersPanelStaffForHall,
    );
  }, [
    staff,
    staffServiceLinks,
    calendarServiceId,
    services,
    mastersSplitResolved,
    mastersPanelStaffForHall,
  ]);

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
    // ALL_STAFF_ID is always a valid selection for admins/managers
    if (staffId === ALL_STAFF_ID) return;
    // Fix stale staffId that's no longer in the roster
    if (!activeStaffForCalendar.some((e) => e.id === staffId)) {
      setStaffId(ALL_STAFF_ID);
    }
  }, [activeStaffForCalendar, staffMember, staffId, isWorkerOnlyEffective]);

  const canUseCalendar = staffMember ? effectiveCanWorkCalendar(staffMember.roles) : false;

  const filteredAppointments = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      return appointments.filter((b) => b.staff_id === staffMember.id);
    }
    return appointments;
  }, [appointments, staffMember, isWorkerOnlyEffective]);

  const goNearestSlot = useCallback(() => {
    if (!canUseCalendar || staffId === ALL_STAFF_ID) return;
    const now = new Date();
    const sched = schedules
      .filter((s) => s.staff_id === staffId)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }));
    for (let d = 0; d < 21; d++) {
      const day = addDays(startOfDay(now), d);
      const slots = generateAvailableSlots({
        schedule: sched,
        appointments: filteredAppointments,
        timeOff,
        duration: durationMin,
        day,
        stepMinutes: 15,
        staffId,
      });
      for (const s of slots) {
        if (s.start.getTime() >= now.getTime() - 30_000) {
          setCursor(day);
          setModal({ start: s.start, staffId });
          return;
        }
      }
    }
  }, [canUseCalendar, staffId, schedules, filteredAppointments, timeOff, durationMin]);

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const monthGridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthGridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: monthGridStart, end: monthGridEnd });
  const days =
    view === "day"
      ? [startOfDay(cursor)]
      : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function appointmentBlocks(day: Date, allStaff = false) {
    return filteredAppointments.filter((b) => {
      if (!allStaff && staffId !== ALL_STAFF_ID && b.staff_id !== staffId) return false;
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

  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  const implicitWeekStaffSet = useMemo(
    () => new Set(implicitWeekExceptSundayStaffIds),
    [implicitWeekExceptSundayStaffIds],
  );

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

  function openQuickBooking() {
    if (!canUseCalendar) return;
    const targetStaffId = staffId === ALL_STAFF_ID ? activeStaffForCalendar[0]?.id : staffId;
    if (!targetStaffId) return;
    const base = startOfDay(cursor);
    const now = new Date();
    const sameDay = isSameDay(base, now);
    const hour = sameDay ? now.getHours() : 10;
    const mins = sameDay ? (now.getMinutes() <= 30 ? 30 : 0) : 0;
    const start = setMinutes(setHours(base, hour), mins);
    setModal({ start, staffId: targetStaffId });
  }

  const main = (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">
            {t("calendar.title")}
          </h1>
          <p className="text-sm text-muted">
            {t("calendar.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line/12 bg-panel/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("day")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "day" ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t("calendar.day")}
            </button>
            <button
              type="button"
              onClick={() => setView("week")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "week" ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t("calendar.week")}
            </button>
            <button
              type="button"
              onClick={() => setView("month")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "month" ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t("calendar.month", { defaultValue: "Месяц" })}
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              setCursor(
                view === "day" ? addDays(cursor, -1) : view === "week" ? addDays(cursor, -7) : addMonths(cursor, -1)
              )
            }
            className="rounded-lg border border-line/15 px-3 py-1.5 text-sm text-fg transition hover:bg-surface/80"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-line/15 px-3 py-1.5 text-sm text-fg transition hover:bg-surface/80"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() =>
              setCursor(
                view === "day" ? addDays(cursor, 1) : view === "week" ? addDays(cursor, 7) : addMonths(cursor, 1)
              )
            }
            className="rounded-lg border border-line/15 px-3 py-1.5 text-sm text-fg transition hover:bg-surface/80"
          >
            →
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {(staffMember && !isWorkerOnlyEffective) && services.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            {t("calendar.bookingService")}
            <select
              value={calendarServiceId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                const n = Number(v);
                setCalendarServiceId(Number.isFinite(n) && String(n) === v ? n : v);
              }}
              className="rounded-lg border border-line/15 bg-panel px-3 py-2 text-fg"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_et}
                </option>
              ))}
            </select>
          </label>
        )}
        {((staffMember && !isWorkerOnlyEffective)) &&
          (view === "week" || view === "month") && (
          <label className="flex items-center gap-2 text-sm text-muted">
            {t("calendar.staff")}
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="rounded-lg border border-line/15 bg-panel px-3 py-2 text-fg"
            >
              <option value={ALL_STAFF_ID}>Все мастера</option>
              {activeStaffForCalendar.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="text-sm text-muted">
          {view === "week"
            ? `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`
            : view === "month"
              ? format(cursor, "LLLL yyyy")
              : format(cursor, "EEEE d MMMM yyyy")}
        </span>
        {canUseCalendar && (
          <button
            type="button"
            onClick={openQuickBooking}
            className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm font-medium text-gold transition hover:bg-gold/15"
          >
            {t("calendar.createBooking", { defaultValue: "Сделать запись" })}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <div className={`grid grid-cols-1 gap-6 ${isReceptionMode ? "" : "xl:grid-cols-[minmax(0,1fr)_320px]"}`}>
          <div className="min-w-0">
            {view === "day" ? (
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
            ) : view === "month" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
                {monthDays.map((day) => {
                  const blocks = appointmentBlocks(day, true);
                  const inCurrentMonth = day >= monthStart && day <= monthEnd;
                  const availability = monthMasterAvailability.get(format(day, "yyyy-MM-dd"));
                  const isToday = isSameDay(day, new Date());
                  /* Используем токены темы (gold + line/muted), чтобы бейджи выглядели
                   * единообразно во всех темах onyx/champagne/stone. */
                  const badgeTone =
                    !availability || availability.working === 0
                      ? "border-line/15 text-muted"
                      : availability.fullyClosed
                        ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                        : availability.free >= Math.ceil(availability.working / 2)
                          ? "border-gold/40 bg-gold/10 text-gold"
                          : "border-amber-400/30 bg-amber-500/10 text-amber-200";
                  return (
                    <div
                      key={day.toISOString()}
                      className={`min-h-[150px] rounded-xl border p-2 transition ${
                        inCurrentMonth
                          ? "border-line/10 bg-panel/60"
                          : "border-line/5 bg-panel/30 opacity-60"
                      } ${isToday ? "ring-1 ring-gold/60 shadow-gold" : ""}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                            isToday ? "bg-gold/15 text-gold" : "text-fg"
                          }`}
                        >
                          {format(day, "d")}
                        </p>
                        <p className="text-[11px] text-muted">{blocks.length}</p>
                      </div>
                      {availability && (
                        <p
                          className={`mb-2 inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${badgeTone}`}
                        >
                          {availability.working > 0
                            ? availability.fullyClosed
                              ? t("calendar.dayClosed", { defaultValue: "День закрыт" })
                              : t("calendar.freeMasters", {
                                  free: availability.free,
                                  total: availability.working,
                                  defaultValue: `Свободно: ${availability.free}/${availability.working}`,
                                })
                            : t("calendar.dayOff", { defaultValue: "Выходной" })}
                        </p>
                      )}
                      <div className="space-y-1">
                        {blocks.slice(0, 4).map((b) => {
                          const svc = services.find((s) => s.id === b.service_id);
                          return (
                            <div
                              key={b.id}
                              className="rounded-md border px-2 py-1 text-xs"
                              style={staffCrmAppointmentBlockStyle(b.staff_id, staff, staffHueMap)}
                            >
                              <p className="truncate font-medium">
                                {format(parseISO(b.start_time), "HH:mm")} · {b.client_name}
                              </p>
                              <p className="truncate opacity-85">{svc?.name_et ?? t("common.service")}</p>
                            </div>
                          );
                        })}
                        {blocks.length > 4 && (
                          <p className="text-[11px] text-muted">+{blocks.length - 4}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : staffId === ALL_STAFF_ID ? (
              <div className="h-[720px] overflow-hidden rounded-xl border border-line/10">
                <ReceptionWeekGrid
                  days={days}
                  staff={activeStaffForCalendar}
                  appointments={filteredAppointments}
                  services={services}
                  schedules={schedules}
                  timeOff={timeOff}
                  visibleStaffIds={new Set(activeStaffForCalendar.map((m) => m.id))}
                  onSlotClick={(start) => {
                    const sid = activeStaffForCalendar[0]?.id;
                    if (sid) setModal({ start, staffId: sid });
                  }}
                  onApptClick={() => {}}
                  onDayHeaderClick={(day, x, y) => setDayPopup({ day, x, y })}
                />
              </div>
            ) : (
              <WeekTimelineGrid
                days={days}
                staffId={staffId}
                schedules={schedules}
                timeOff={timeOff}
                appointments={filteredAppointments}
                services={services}
                staff={staff}
                staffHueMap={staffHueMap}
                getWorkingStaffForDay={(d) =>
                  panelStaffWorkingOnDate(staff, schedules, d, implicitWeekStaffSet, timeOff)
                }
                onFreeClick={(start) => setModal({ start, staffId })}
                canClick={canUseCalendar}
              />
            )}
          </div>

          {!isReceptionMode && (
            <CalendarSidePanels
              cursor={cursor}
              staff={activeStaffForCalendar}
              appointments={filteredAppointments}
              services={services}
              schedules={schedules}
              timeOff={timeOff}
              focusStaffId={staffId === ALL_STAFF_ID ? null : staffId}
              serviceDurationMin={durationMin}
              onNearestSlot={canUseCalendar && staffId !== ALL_STAFF_ID ? goNearestSlot : undefined}
              onCreateBooking={canUseCalendar ? openQuickBooking : undefined}
            />
          )}
        </div>
      )}

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
        />
      )}

      {dayPopup && (
        <DaySchedulePopup
          day={dayPopup.day}
          anchorX={dayPopup.x}
          anchorY={dayPopup.y}
          allStaff={activeStaffForCalendar}
          schedules={schedules}
          onClose={() => setDayPopup(null)}
          onSaved={() => { setDayPopup(null); void load(); }}
        />
      )}
    </div>
  );

  return main;
}
