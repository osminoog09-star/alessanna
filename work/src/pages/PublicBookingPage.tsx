import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { generateAvailableSlots, formatSlotRange, type Slot } from "../lib/slots";
import {
  applyPublicStaffVisibility,
  isStaffRowAdmin,
  isStaffShownOnPublicMarketing,
  normalizeStaffMember,
  staffEligibleForService,
} from "../lib/roles";
import type { AppointmentRow, StaffMember, StaffScheduleRow, StaffServiceRow } from "../types/database";

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
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([]);
  const [monthAppointments, setMonthAppointments] = useState<AppointmentRow[]>([]);
  const [monthTimeOff, setMonthTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);
  const [timeOff, setTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(ANY_MASTER_ID);
  const [dayStr, setDayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const isReceptionMode = location.pathname === "/reception";

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [st, lk, sc] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
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

  const loadMonthCalendarData = useCallback(async () => {
    if (!isSupabaseConfigured() || serviceId == null) {
      setMonthAppointments([]);
      setMonthTimeOff([]);
      return;
    }
    const eligibleIds = eligibleStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setMonthAppointments([]);
      setMonthTimeOff([]);
      return;
    }
    const monthStartUtc = startOfDay(startOfMonth(viewMonth)).toISOString();
    const monthEndUtc = endOfDay(endOfMonth(viewMonth)).toISOString();
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", monthStartUtc)
        .lte("start_time", monthEndUtc)
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", eligibleIds)
        .lte("start_time", monthEndUtc)
        .gte("end_time", monthStartUtc),
    ]);
    if (ap.data) setMonthAppointments(ap.data as AppointmentRow[]);
    if (to.data) {
      setMonthTimeOff(
        (to.data as Array<{ staff_id: string; start_time: string; end_time: string }>).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        }))
      );
    }
  }, [eligibleStaff, serviceId, viewMonth]);

  useEffect(() => {
    void loadMonthCalendarData();
  }, [loadMonthCalendarData]);

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

    const monthDaysOnly = calendarDays.filter((d) => isSameMonth(d, monthStart));
    for (const d of monthDaysOnly) {
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
          appointments: monthAppointments,
          timeOff: monthTimeOff,
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
    calendarDays,
    durationMin,
    eligibleStaff,
    monthAppointments,
    monthStart,
    monthTimeOff,
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
        void loadMonthCalendarData();
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
    void loadMonthCalendarData();
    void loadUpcomingData();
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

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-200 md:px-6 md:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-2xl font-semibold text-white md:text-3xl">{t("publicBook.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isReceptionMode
            ? "Режим ресепшен: быстрая запись клиента без входа в CRM."
            : t("publicBook.subtitle")}
        </p>
        <Link to="/login" className="mt-2 inline-block text-sm text-sky-400">
          {t("publicBook.staffLogin")}
        </Link>

        <div className="mt-6 space-y-6 md:mt-8">
          <div className="grid gap-4 md:grid-cols-[1.45fr_1fr] md:gap-5">
            <section className="rounded-xl border border-zinc-800 bg-black/30 p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-200">{t("publicBook.day")}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
                >
                  ←
                </button>
                <span className="min-w-[120px] text-center text-xs text-zinc-400">{monthLabel}</span>
                <button
                  type="button"
                  onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
                >
                  →
                </button>
              </div>
            </div>
            <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[10px] uppercase tracking-wide text-zinc-600 md:gap-2 md:text-xs">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5 md:gap-2">
              {calendarDays.map((d) => {
                const selected = isSameDay(d, selectedDay);
                const inMonth = isSameMonth(d, monthStart);
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
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => {
                      setDayStr(format(d, "yyyy-MM-dd"));
                      setViewMonth(startOfMonth(d));
                      setPickedStart(null);
                    }}
                    className={
                      "rounded-md border px-2 py-2 text-xs transition md:min-h-[54px] md:text-sm " +
                      (selected
                        ? "border-sky-500 bg-sky-950/50 text-white"
                        : inMonth
                          ? "border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-white"
                          : "border-zinc-900 text-zinc-600 hover:border-zinc-800")
                    }
                  >
                    <span className="block">{format(d, "d")}</span>
                    {inMonth && cov && (
                      <span className={`mt-0.5 block text-[10px] ${tone}`}>
                        {cov.working > 0 ? `${cov.free}/${cov.working}` : "—"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-black/30 p-4 md:p-5">
              <h2 className="text-sm font-semibold text-white">Ближайшие работы</h2>
              <p className="mt-1 text-xs text-zinc-500">Следующие записи по салону.</p>
              <div className="mt-3 space-y-2">
                {receptionUpcoming.length > 0 ? (
                  receptionUpcoming.map((ap) => {
                    const master = staff.find((s) => s.id === ap.staff_id);
                    const svcName = services.find((s) => String(s.id) === String(ap.service_id))?.name || "—";
                    return (
                      <div
                        key={ap.id}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300"
                      >
                        <div className="font-medium text-zinc-100">
                          {ap.start_time
                            ? new Date(ap.start_time).toLocaleString(i18n.language, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "—"}
                        </div>
                        <div className="mt-0.5 text-zinc-400">
                          {master?.name || "—"} · {svcName}
                        </div>
                        <div className="mt-0.5 text-zinc-500">{ap.client_name || "—"}</div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-zinc-600">Ближайших записей пока нет.</p>
                )}
              </div>
            </section>
          </div>

          {serviceId != null && (
            <div className="grid gap-4 md:grid-cols-[1.45fr_1fr] md:gap-5">
              <section className="rounded-xl border border-zinc-800 bg-black/30 p-4 md:p-5">
                <h2 className="text-sm font-semibold text-white">Свободные мастера</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Нажмите на мастера, чтобы сразу смотреть его доступные слоты.
                </p>
                <div className="mt-3 space-y-2">
                  {masterDayLoad.length > 0 ? (
                    masterDayLoad.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setStaffId(m.id);
                          setPickedStart(null);
                        }}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-sky-700/70 hover:text-white md:px-4 md:py-2.5 md:text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-zinc-100">{m.name}</span>
                          <span
                            className={
                              "rounded-full border px-2 py-0.5 text-[10px] " +
                              (m.status === "free"
                                ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-200"
                                : m.status === "off"
                                  ? "border-zinc-700 bg-zinc-900 text-zinc-400"
                                  : "border-amber-700/60 bg-amber-950/40 text-amber-200")
                            }
                          >
                            {m.status === "free" ? "Есть окна" : m.status === "off" ? "Выходной" : "Занят"}
                          </span>
                        </div>
                        <div className="mt-1 text-zinc-500">
                          {m.workTime} · свободных: {m.freeSlots}
                        </div>
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-600">Нет мастеров для выбранной услуги.</p>
                  )}
                </div>
              </section>
            </div>
          )}

          {serviceId != null && (
            <>
              <label className="block text-sm">
                <span className="text-zinc-400">{t("modal.service")}</span>
                <select
                  value={serviceId ?? ""}
                  onChange={(e) => {
                    setServiceId(e.target.value ? String(e.target.value) : null);
                    setStaffId(ANY_MASTER_ID);
                    setPickedStart(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white md:py-2.5"
                >
                  <option value="">{t("modal.pickService")}</option>
                  {services.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="text-sm text-zinc-400">{t("publicBook.slots")}</p>
                {staffId === ANY_MASTER_ID && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Показаны слоты, где есть хотя бы один свободный мастер.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => {
                    const key = s.start.toISOString();
                    const freeCount = slotCoverage.get(key) || 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPickedStart(s.start)}
                        className={`rounded-lg border px-3 py-2 text-sm md:px-4 md:py-2.5 ${
                          pickedStart?.getTime() === s.start.getTime()
                            ? "border-sky-500 bg-sky-950/50 text-white"
                            : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                        }`}
                      >
                        {formatSlotRange(s)}
                        {staffId === ANY_MASTER_ID && freeCount > 0 ? ` · свободно: ${freeCount}` : ""}
                      </button>
                    );
                  })}
                </div>
                {slots.length === 0 && <p className="mt-2 text-xs text-zinc-600">{t("publicBook.noSlots")}</p>}
              </div>

              <label className="block text-sm">
                <span className="text-zinc-400">Мастер (по желанию)</span>
                <select
                  value={staffId ?? ANY_MASTER_ID}
                  onChange={(e) => {
                    setStaffId(e.target.value || ANY_MASTER_ID);
                    setPickedStart(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white md:py-2.5"
                >
                  <option value={ANY_MASTER_ID}>Любой свободный мастер</option>
                  {eligibleStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              {pickedStart && (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <p className="text-sm text-zinc-400">
                    {pickedStart.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <input
                    placeholder={isReceptionMode ? "Имя клиента (необязательно)" : (t("modal.client") as string)}
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
                  />
                  <input
                    placeholder={isReceptionMode ? "Телефон (необязательно)" : (t("modal.phone") as string)}
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={booking}
                    onClick={() => void confirmBook()}
                    className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t("publicBook.confirm")}
                  </button>
                </div>
              )}
            </>
          )}

          {msg && <p className="text-sm text-emerald-400/90">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
