import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { generateAvailableSlots, type Slot } from "../lib/slots";
import {
  applyPublicStaffVisibility,
  isStaffRowAdmin,
  isStaffShownOnPublicMarketing,
  normalizeStaffMember,
  staffEligibleForService,
} from "../lib/roles";
import type { AppointmentRow, StaffMember, StaffScheduleRow, StaffServiceRow } from "../types/database";
import {
  DEFAULT_RECEPTION_ROWS,
  type ReceptionRows,
  type ReceptionSectionId,
  loadReceptionLayoutRows,
  persistReceptionLayoutRows,
} from "../lib/receptionLayout";
import { fetchReceptionLayoutFromServer, saveReceptionLayoutToServer } from "../lib/receptionLayoutRemote";
import { renderReceptionRows } from "../lib/receptionSectionOrderRender";
import { ReceptionLayoutEditor } from "../components/ReceptionLayoutEditor";
import {
  PublicBookingBookingSection,
  PublicBookingCalendarSection,
  PublicBookingMastersSection,
  PublicBookingUpcomingSection,
} from "../components/PublicBookingLayoutSections";

type PublicService = {
  id: string;
  name: string;
  duration_min: number;
  buffer_after_min: number;
  active: boolean;
};

const ANY_MASTER_ID = "any";

export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { isAdmin, staffMember } = useAuth();
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([]);
  const [calendarRangeAppointments, setCalendarRangeAppointments] = useState<AppointmentRow[]>([]);
  const [calendarRangeTimeOff, setCalendarRangeTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);
  const [timeOff, setTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(ANY_MASTER_ID);
  const [dayStr, setDayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [calendarScope, setCalendarScope] = useState<"month" | "year">("month");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const isReceptionMode = location.pathname === "/reception";
  const [receptionRows, setReceptionRows] = useState<ReceptionRows>(() =>
    DEFAULT_RECEPTION_ROWS.map((r) => [...r]),
  );
  const [receptionLayoutEditing, setReceptionLayoutEditing] = useState(false);
  const [receptionRemoteSaveError, setReceptionRemoteSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) setReceptionLayoutEditing(false);
  }, [isAdmin]);

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [st, lk, sc, remoteLayout] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
      fetchReceptionLayoutFromServer(),
    ]);
    /* Fallback по `select(...)`: каждая ветка возвращает свой shape, поэтому
     * для TS ниже всегда `as typeof sv`. На рантайме всё равно нормализуем. */
    let sv = await supabase
      .from("service_listings")
      .select("id,name,duration,buffer_after_min,is_active")
      .order("name");
    if (sv.error) {
      sv = (await supabase
        .from("service_listings")
        .select("id,name,duration,is_active")
        .order("name")) as typeof sv;
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration,buffer_after_min")
          .order("name")) as typeof sv;
      }
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration")
          .order("name")) as typeof sv;
      }
    }
    if (sv.data) {
      const normalized = (sv.data as Array<{ id: string; name: string; duration?: number; buffer_after_min?: number; is_active?: boolean }>).map((s) => ({
          id: String(s.id),
          name: String(s.name || "").trim(),
          duration_min: Number(s.duration || 0),
          buffer_after_min: Number(s.buffer_after_min || 10),
          active: s.is_active !== false,
        }));
      setServices(normalized);
      const firstActive = normalized.find((s) => s.active);
      if (firstActive) {
        setServiceId((prev) => prev ?? firstActive.id);
      }
    }
    if (st.data) {
      setStaff(
        (st.data as Record<string, unknown>[])
          .filter((row) => !isStaffRowAdmin(row))
          .map((r) => normalizeStaffMember(r as StaffMember))
          .filter((m) => isStaffShownOnPublicMarketing(m))
      );
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    if (sc.data) setSchedules(sc.data as StaffScheduleRow[]);
    if (remoteLayout) {
      setReceptionRows(remoteLayout);
      persistReceptionLayoutRows(remoteLayout);
    } else {
      setReceptionRows(loadReceptionLayoutRows());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const day = useMemo(() => startOfDay(new Date(dayStr + "T12:00:00")), [dayStr]);
  const selectedDay = useMemo(() => startOfDay(new Date(dayStr + "T12:00:00")), [dayStr]);
  const monthStart = useMemo(() => startOfMonth(viewMonth), [viewMonth]);
  const monthLabel = useMemo(() => format(monthStart, "LLLL yyyy"), [monthStart]);
  const calendarDays = useMemo(() => {
    const from = startOfWeek(monthStart, { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [monthStart]);

  const eligibleStaff = useMemo(() => {
    if (serviceId == null) return [];
    const base = staffEligibleForService(staff, links, serviceId);
    return applyPublicStaffVisibility(base, links, serviceId);
  }, [staff, links, serviceId]);

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured() || serviceId == null) return;
    const eligibleIds = eligibleStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setAppointments([]);
      setTimeOff([]);
      return;
    }
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", start.toISOString())
        .lte("start_time", end.toISOString())
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", eligibleIds)
        .lte("start_time", end.toISOString())
        .gte("end_time", start.toISOString()),
    ]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (to.data) {
      setTimeOff(
        (to.data as { staff_id: string; start_time: string; end_time: string }[]).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        }))
      );
    }
  }, [day, eligibleStaff, serviceId]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  const loadUpcomingData = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("appointments")
      .select("*")
      .gte("start_time", nowIso)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true })
      .limit(60);
    if (data) setUpcomingAppointments(data as AppointmentRow[]);
  }, []);

  useEffect(() => {
    void loadUpcomingData();
  }, [loadUpcomingData]);

  const loadCalendarRangeData = useCallback(async () => {
    if (!isSupabaseConfigured() || serviceId == null) {
      setCalendarRangeAppointments([]);
      setCalendarRangeTimeOff([]);
      return;
    }
    const eligibleIds = eligibleStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setCalendarRangeAppointments([]);
      setCalendarRangeTimeOff([]);
      return;
    }
    const rangeFrom =
      calendarScope === "year" ? startOfYear(viewMonth) : startOfMonth(viewMonth);
    const rangeTo = calendarScope === "year" ? endOfYear(viewMonth) : endOfMonth(viewMonth);
    const rangeStartUtc = startOfDay(rangeFrom).toISOString();
    const rangeEndUtc = endOfDay(rangeTo).toISOString();
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", rangeStartUtc)
        .lte("start_time", rangeEndUtc)
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", eligibleIds)
        .lte("start_time", rangeEndUtc)
        .gte("end_time", rangeStartUtc),
    ]);
    if (ap.data) setCalendarRangeAppointments(ap.data as AppointmentRow[]);
    if (to.data) {
      setCalendarRangeTimeOff(
        (to.data as Array<{ staff_id: string; start_time: string; end_time: string }>).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        }))
      );
    }
  }, [calendarScope, eligibleStaff, serviceId, viewMonth]);

  useEffect(() => {
    void loadCalendarRangeData();
  }, [loadCalendarRangeData]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const svc = services.find((s) => s.id === serviceId);
  const durationMin = svc ? svc.duration_min + svc.buffer_after_min : 60;

  const slotsByStaff = useMemo(() => {
    if (!svc) return new Map<string, Slot[]>();
    const out = new Map<string, Slot[]>();
    for (const member of eligibleStaff) {
      const memberSchedule = schedules
        .filter((s) => s.staff_id === member.id)
        .map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        }));
      const rawSlots = generateAvailableSlots({
        schedule: memberSchedule,
        appointments,
        timeOff,
        duration: durationMin,
        day,
        stepMinutes: 15,
        staffId: member.id,
      });
      const slots = rawSlots.filter((s) => s.start.getTime() >= nowTick);
      out.set(member.id, slots);
    }
    return out;
  }, [appointments, day, durationMin, eligibleStaff, schedules, svc, timeOff, nowTick]);

  const slotCoverage = useMemo(() => {
    const coverage = new Map<string, number>();
    for (const slots of slotsByStaff.values()) {
      for (const s of slots) {
        const key = s.start.toISOString();
        coverage.set(key, (coverage.get(key) || 0) + 1);
      }
    }
    return coverage;
  }, [slotsByStaff]);

  const slots = useMemo(() => {
    if (!svc) return [];
    if (staffId && staffId !== ANY_MASTER_ID) {
      return slotsByStaff.get(staffId) || [];
    }
    const byStart = new Map<string, Slot>();
    for (const staffSlots of slotsByStaff.values()) {
      for (const s of staffSlots) {
        const key = s.start.toISOString();
        if (!byStart.has(key)) byStart.set(key, s);
      }
    }
    return Array.from(byStart.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [slotsByStaff, staffId, svc]);

  const dayAvailabilityBadge = useMemo(() => {
    const out = new Map<
      string,
      {
        free: number;
        working: number;
      }
    >();
    if (!svc || !eligibleStaff.length) return out;

    const intervalStart = calendarScope === "year" ? startOfYear(viewMonth) : startOfMonth(viewMonth);
    const intervalEnd = calendarScope === "year" ? endOfYear(viewMonth) : endOfMonth(viewMonth);
    const daysInRange = eachDayOfInterval({ start: intervalStart, end: intervalEnd });
    for (const d of daysInRange) {
      const weekday = d.getDay();
      const key = format(d, "yyyy-MM-dd");
      let working = 0;
      let free = 0;

      for (const m of eligibleStaff) {
        const memberSchedule = schedules
          .filter((s) => s.staff_id === m.id && s.day_of_week === weekday)
          .map((s) => ({
            day_of_week: s.day_of_week,
            start_time: s.start_time,
            end_time: s.end_time,
          }));
        if (!memberSchedule.length) continue;
        working++;
        const rawSlotsForDay = generateAvailableSlots({
          schedule: memberSchedule,
          appointments: calendarRangeAppointments,
          timeOff: calendarRangeTimeOff,
          duration: durationMin,
          day: d,
          stepMinutes: 15,
          staffId: m.id,
        });
        const slotsForDay = rawSlotsForDay.filter((s) =>
          isSameDay(d, new Date()) ? s.start.getTime() >= nowTick : true
        );
        if (slotsForDay.length > 0) free++;
      }

      out.set(key, { free, working });
    }
    return out;
  }, [
    calendarScope,
    viewMonth,
    durationMin,
    eligibleStaff,
    calendarRangeAppointments,
    calendarRangeTimeOff,
    schedules,
    svc,
    nowTick,
  ]);

  const masterDayLoad = useMemo(() => {
    const weekday = day.getDay();
    return eligibleStaff
      .map((m) => {
        const daySchedule = schedules
          .filter((s) => s.staff_id === m.id && s.day_of_week === weekday)
          .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
        const workTime =
          daySchedule.length > 0
            ? `${String(daySchedule[0].start_time || "").slice(0, 5)}–${String(
                daySchedule[daySchedule.length - 1].end_time || ""
              ).slice(0, 5)}`
            : "выходной";
        const freeSlots = (slotsByStaff.get(m.id) || []).length;
        const busyItems = appointments.filter((a) => a.staff_id === m.id).length;
        const timeOffItems = timeOff.filter((t) => t.staff_id === m.id).length;
        let status: "free" | "busy" | "off" = "busy";
        if (!daySchedule.length) status = "off";
        else if (freeSlots > 0) status = "free";
        return {
          id: m.id,
          name: m.name,
          workTime,
          freeSlots,
          busyItems,
          timeOffItems,
          status,
        };
      })
      .sort((a, b) => {
        if (a.status === b.status) return b.freeSlots - a.freeSlots;
        if (a.status === "free") return -1;
        if (b.status === "free") return 1;
        if (a.status === "busy" && b.status === "off") return -1;
        if (a.status === "off" && b.status === "busy") return 1;
        return 0;
      });
  }, [appointments, day, eligibleStaff, schedules, slotsByStaff, timeOff]);

  const receptionUpcoming = useMemo(() => {
    const allowedStaffIds = new Set(staff.map((s) => s.id));
    return upcomingAppointments
      .filter((a) => allowedStaffIds.has(a.staff_id))
      .slice(0, 8);
  }, [staff, upcomingAppointments]);

  async function confirmBook() {
    const normalizedClientName = clientName.trim();
    if (!svc || !pickedStart || (!isReceptionMode && !normalizedClientName)) {
      setMsg(t("publicBook.fillAll"));
      return;
    }
    setBooking(true);
    setMsg(null);
    let finalStaffId = staffId && staffId !== ANY_MASTER_ID ? staffId : null;
    if (!finalStaffId) {
      for (const candidate of eligibleStaff) {
        const candidateSlots = slotsByStaff.get(candidate.id) || [];
        if (candidateSlots.some((s) => s.start.getTime() === pickedStart.getTime())) {
          finalStaffId = candidate.id;
          break;
        }
      }
    }
    if (!finalStaffId) {
      setBooking(false);
      setMsg("На выбранное время нет свободного мастера. Выберите другое время.");
      return;
    }
    if (pickedStart.getTime() < Date.now()) {
      setBooking(false);
      setMsg("Это время уже прошло. Выберите актуальный слот.");
      void loadDayData();
      return;
    }
    const end = new Date(pickedStart.getTime() + durationMin * 60 * 1000);
    /* Колонок `source`/`notes` нет в актуальной схеме `appointments`. Отправляем
     *  только реально существующие — иначе PostgREST вернёт ошибку schema cache. */
    const { error } = await supabase.from("appointments").insert({
      staff_id: finalStaffId,
      service_id: svc.id,
      client_name: normalizedClientName || "Клиент (ресепшен)",
      client_phone: clientPhone.trim() || null,
      start_time: pickedStart.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    });
    setBooking(false);
    if (error) {
      if (error.code === "23P01" || /overlap|занят/i.test(String(error.message || ""))) {
        setMsg("Это время уже занято. Выберите другой слот.");
        void loadDayData();
        void loadCalendarRangeData();
        return;
      }
      setMsg(error.message);
      return;
    }
    setMsg(t("publicBook.success"));
    setPickedStart(null);
    setClientName("");
    setClientPhone("");
    void loadDayData();
    void loadCalendarRangeData();
    void loadUpcomingData();
  }

  function renderDayButtons(gridDays: Date[], anchorMonth: Date, compact: boolean) {
    return gridDays.map((d) => {
      const selected = isSameDay(d, selectedDay);
      const today = isToday(d);
      const inMonth = isSameMonth(d, anchorMonth);
      const cov = dayAvailabilityBadge.get(format(d, "yyyy-MM-dd"));
      const isWorkingDay = !!(cov && cov.working > 0);
      const ratio = cov && cov.working > 0 ? cov.free / cov.working : 0;
      const tone =
        !isWorkingDay
          ? "text-zinc-600"
          : ratio >= 0.6
            ? "text-emerald-300"
            : ratio > 0
              ? "text-amber-300"
              : "text-red-300";
      const sizeClass = compact
        ? "min-h-[2.25rem] px-0.5 py-0.5 text-[10px] sm:min-h-10 sm:text-[11px]"
        : "px-2 py-2 text-xs md:min-h-[54px] md:text-sm";

      let stateClass: string;
      if (selected && today) {
        stateClass =
          "border-sky-500 bg-sky-950/50 text-white ring-2 ring-emerald-400/45 ring-offset-2 ring-offset-zinc-950";
      } else if (selected) {
        stateClass = "border-sky-500 bg-sky-950/50 text-white";
      } else if (today) {
        stateClass =
          "border-emerald-500/75 bg-emerald-950/30 text-zinc-100 hover:border-emerald-400 hover:bg-emerald-950/45";
      } else if (inMonth) {
        stateClass = "border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white";
      } else {
        stateClass = "border-zinc-900 text-zinc-600 hover:border-zinc-800";
      }

      return (
        <button
          key={d.toISOString()}
          type="button"
          aria-current={today ? "date" : undefined}
          title={today ? t("publicBook.todayMarker") : undefined}
          onClick={() => {
            setDayStr(format(d, "yyyy-MM-dd"));
            setViewMonth(startOfMonth(d));
            setPickedStart(null);
          }}
          className={`rounded-md border transition ${sizeClass} ${stateClass}`}
        >
          <span className="block">{format(d, "d")}</span>
          {inMonth && cov && (
            <span className={`mt-0.5 block ${compact ? "text-[9px] leading-tight" : "text-[10px]"} ${tone}`}>
              {cov.working > 0 ? `${cov.free}/${cov.working}` : "—"}
            </span>
          )}
        </button>
      );
    });
  }

  function persistReceptionLayoutFromReception(next: ReceptionRows) {
    setReceptionRemoteSaveError(null);
    persistReceptionLayoutRows(next);
    void saveReceptionLayoutToServer(next).then(({ error: saveErr }) => {
      setReceptionRemoteSaveError(saveErr);
    });
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8 text-zinc-300">
        <p>{t("login.configLine")}</p>
        <Link className="mt-4 block text-sky-400" to="/login">
          Staff login
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }

  const receptionSections: Record<ReceptionSectionId, ReactNode | null> = {
    calendar: (
      <PublicBookingCalendarSection
        t={t}
        calendarScope={calendarScope}
        setCalendarScope={setCalendarScope}
        viewMonth={viewMonth}
        setViewMonth={setViewMonth}
        monthLabel={monthLabel}
        monthStart={monthStart}
        calendarDays={calendarDays}
        renderDayButtons={renderDayButtons}
      />
    ),
    upcoming: (
      <PublicBookingUpcomingSection
        receptionUpcoming={receptionUpcoming}
        staff={staff}
        services={services}
        i18n={i18n}
      />
    ),
    masters:
      serviceId != null ? (
        <PublicBookingMastersSection
          masterDayLoad={masterDayLoad}
          setStaffId={setStaffId}
          setPickedStart={setPickedStart}
        />
      ) : null,
    booking:
      serviceId != null ? (
        <PublicBookingBookingSection
          t={t}
          i18n={i18n}
          isReceptionMode={isReceptionMode}
          serviceId={serviceId}
          setServiceId={setServiceId}
          setStaffId={setStaffId}
          services={services}
          staffId={staffId}
          ANY_MASTER_ID={ANY_MASTER_ID}
          slots={slots}
          slotCoverage={slotCoverage}
          pickedStart={pickedStart}
          setPickedStart={setPickedStart}
          clientName={clientName}
          setClientName={setClientName}
          clientPhone={clientPhone}
          setClientPhone={setClientPhone}
          booking={booking}
          confirmBook={confirmBook}
          eligibleStaff={eligibleStaff}
        />
      ) : null,
  };

  const mainContent = renderReceptionRows(receptionRows, receptionSections);

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-200 md:px-6 md:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-2xl font-semibold text-white md:text-3xl">{t("publicBook.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isReceptionMode
            ? "Режим ресепшен: быстрая запись клиента без входа в CRM."
            : t("publicBook.subtitle")}
        </p>
        <Link to="/login" className="mt-2 inline-block text-sm text-sky-400">
          {t("publicBook.staffLogin")}
        </Link>

        {isReceptionMode && staffMember && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700/80 bg-zinc-900/60 px-3 py-2.5 text-sm">
            <Link
              to="/"
              className="font-medium text-sky-400 transition hover:text-sky-300"
            >
              ← {t("nav.backToCrm")}
            </Link>
            <span className="hidden text-zinc-600 sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="text-xs text-zinc-500">{t("nav.receptionHint")}</span>
          </div>
        )}

        {isReceptionMode && isAdmin && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-950/15 p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReceptionLayoutEditing((v) => !v)}
                className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-950/45"
              >
                {receptionLayoutEditing ? t("reception.layout.done") : t("reception.layout.edit")}
              </button>
              {receptionLayoutEditing && (
                <button
                  type="button"
                  onClick={() => {
                    const next = DEFAULT_RECEPTION_ROWS.map((r) => [...r]);
                    setReceptionRows(next);
                    if (isAdmin) persistReceptionLayoutFromReception(next);
                  }}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  {t("reception.layout.reset")}
                </button>
              )}
            </div>
            {receptionLayoutEditing && (
              <p className="mt-2 text-xs text-zinc-500">{t("reception.layout.hint")}</p>
            )}
            {receptionRemoteSaveError && (
              <p className="mt-2 text-xs text-rose-400">
                {t("siteSettings.receptionLayoutSaveError", { message: receptionRemoteSaveError })}
              </p>
            )}
            {receptionLayoutEditing && (
              <div className="mt-3">
                <ReceptionLayoutEditor
                  variant="compact"
                  rows={receptionRows}
                  onChange={(next) => {
                    setReceptionRows(next);
                    if (isReceptionMode && isAdmin) persistReceptionLayoutFromReception(next);
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-6 space-y-6 md:mt-8">
          {mainContent}

          {msg && <p className="text-sm text-emerald-400/90">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
