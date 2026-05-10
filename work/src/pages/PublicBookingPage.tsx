import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  addMonths,
  addYears,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  compareSalonYmd,
  gregorianAddDays,
  isSalonBookableYmd,
  normalizePublicBookingDayStr,
  salonCalendarYmd,
  salonDayStartUtc,
  salonFirstBookableYmd,
  salonWeekdaySun0,
  salonYmdFromAnyDate,
  SALON_TIME_ZONE,
} from "../lib/bookingSalonTz";
import { generateAvailableSlots, type Slot } from "../lib/slots";
import { quickBookMergedFreeMinutes } from "../lib/quickBookingSchedule";
import {
  applyPublicStaffVisibility,
  isStaffRowAdmin,
  isStaffShownOnPublicMarketing,
  normalizeStaffMember,
  staffEligibleForService,
} from "../lib/roles";
import { eachDayInDataRange, getCalendarDataRange, type PublicCalendarScope } from "../lib/publicCalendarRange";
import {
  publicBookableStaffMembers,
  publicServiceIdsForStaff,
  restrictAndOrderStaffByServiceHall,
  splitStaffIntoHairAndNails,
} from "../lib/publicMasterPanel";
import { buildStaffColorAssignments, resolveStaffPublicCalendarLook } from "../lib/staffCalendarColors";
import type { AppointmentRow, StaffMember, StaffScheduleRow, StaffServiceRow } from "../types/database";
import {
  DEFAULT_RECEPTION_MASTERS_PANEL,
  DEFAULT_RECEPTION_ROWS,
  DEFAULT_RECEPTION_UPCOMING_PANEL,
  type ReceptionMastersPanelConfig,
  type ReceptionRows,
  type ReceptionSectionId,
  type ReceptionUpcomingPanelConfig,
  loadReceptionLayoutStore,
  persistReceptionLayoutStore,
} from "../lib/receptionLayout";
import {
  CALENDAR_WEEK_EXCEPT_SUNDAY_STAFF_SETTING_KEY,
  parseStaffIdJsonList,
} from "../lib/calendarWorkingStaff";
import { fetchReceptionLayoutFromServer } from "../lib/receptionLayoutRemote";
import { renderReceptionRows } from "../lib/receptionSectionOrderRender";
import {
  PublicBookingBookingSection,
  PublicBookingCalendarSection,
  PublicBookingMastersSection,
  PublicBookingUpcomingSection,
  type MasterDayRow,
} from "../components/PublicBookingLayoutSections";

type PublicService = {
  id: string;
  name: string;
  duration_min: number;
  buffer_after_min: number;
  active: boolean;
  categoryName: string | null;
  price_eur: number | null;
};

const ANY_MASTER_ID = "any";

function sortMasterDayRows(a: MasterDayRow, b: MasterDayRow): number {
  if (a.status === b.status) return b.freeMinutesUnion - a.freeMinutesUnion;
  if (a.status === "free") return -1;
  if (b.status === "free") return 1;
  if (a.status === "busy" && b.status === "off") return -1;
  if (a.status === "off" && b.status === "busy") return 1;
  return 0;
}

/** Публичная онлайн-запись (`/book`). Рабочий календарь CRM — `/calendar`. */
export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const { staffMember } = useAuth();
  const [services, setServices] = useState<PublicService[]>([]);
  /** Все активные сотрудники (не админы) из CRM — для ресепшена и ручного состава панели. */
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>([]);
  /** Подмножество: показываются на маркетинге / публичной записи. */
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
  const [dayStr, setDayStr] = useState(() => salonFirstBookableYmd());
  /** Всегда валидная ymd для TZ-математики (иначе salonDayStartUtc/salonWeekdaySun0 роняют рендер). */
  const bookYmd = useMemo(() => normalizePublicBookingDayStr(dayStr), [dayStr]);
  const [viewMonth, setViewMonth] = useState(() => {
    const fb = salonFirstBookableYmd();
    const [y, m] = fb.split("-").map(Number);
    return new Date(y, m - 1, 1);
  });
  useEffect(() => {
    if (!Number.isFinite(viewMonth.getTime())) {
      const fb = salonFirstBookableYmd();
      const [y, m] = fb.split("-").map(Number);
      setViewMonth(new Date(y, m - 1, 1));
    }
  }, [viewMonth]);
  const [calendarScope, setCalendarScope] = useState<PublicCalendarScope>("month");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientNote, setClientNote] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [receptionRows, setReceptionRows] = useState<ReceptionRows>(() =>
    DEFAULT_RECEPTION_ROWS.map((r) => [...r]),
  );
  const [receptionMastersConfig, setReceptionMastersConfig] = useState<ReceptionMastersPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_MASTERS_PANEL,
  }));
  const [receptionUpcomingConfig, setReceptionUpcomingConfig] = useState<ReceptionUpcomingPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_UPCOMING_PANEL,
  }));
  /** Мастера пн–сб без строк в staff_schedule — uuid из salon_settings. */
  const [implicitWeekExceptSundayStaffIds, setImplicitWeekExceptSundayStaffIds] = useState<string[]>([]);


  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [st, lk, sc, remoteLayout, implicitSetting] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
      fetchReceptionLayoutFromServer(),
      supabase.from("salon_settings").select("value").eq("key", CALENDAR_WEEK_EXCEPT_SUNDAY_STAFF_SETTING_KEY).maybeSingle(),
    ]);
    /* Fallback по `select(...)`: каждая ветка возвращает свой shape, поэтому
     * для TS ниже всегда `as typeof sv`. На рантайме всё равно нормализуем. */
    let sv = await supabase
      .from("service_listings")
      .select("id,name,duration,buffer_after_min,is_active,category_id,price,service_categories(name)")
      .order("name");
    if (sv.error) {
      sv = (await supabase
        .from("service_listings")
        .select("id,name,duration,buffer_after_min,is_active,price")
        .order("name")) as typeof sv;
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration,buffer_after_min,is_active")
          .order("name")) as typeof sv;
      }
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration,is_active")
          .order("name")) as typeof sv;
      }
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
      type SvRow = {
        id: string;
        name: string;
        duration?: number;
        buffer_after_min?: number;
        is_active?: boolean;
        price?: number | null;
        service_categories?: { name?: string | null } | null;
      };
      const normalized = (sv.data as SvRow[]).map((s) => {
        const catName = String(s.service_categories?.name || "").trim();
        const priceRaw = s.price;
        const price_eur =
          priceRaw != null && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
        return {
          id: String(s.id),
          name: String(s.name || "").trim(),
          duration_min: Number(s.duration || 0),
          buffer_after_min: Number(s.buffer_after_min ?? 10),
          active: s.is_active !== false,
          categoryName: catName || null,
          price_eur,
        };
      });
      setServices(normalized);
      const firstActive = normalized.find((s) => s.active);
      if (firstActive) {
        setServiceId((prev) => prev ?? firstActive.id);
      }
    }
    if (st.data) {
      const directory = (st.data as Record<string, unknown>[])
        .filter((row) => !isStaffRowAdmin(row))
        .map((r) => normalizeStaffMember(r as StaffMember));
      setStaffDirectory(directory);
      setStaff(directory.filter((m) => isStaffShownOnPublicMarketing(m)));
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    if (sc.data) setSchedules(sc.data as StaffScheduleRow[]);
    setImplicitWeekExceptSundayStaffIds(
      parseStaffIdJsonList(
        implicitSetting.data?.value != null ? String(implicitSetting.data.value) : undefined,
      ),
    );
    if (remoteLayout) {
      setReceptionRows(remoteLayout.rows);
      setReceptionMastersConfig(remoteLayout.masters);
      setReceptionUpcomingConfig(remoteLayout.upcoming);
      persistReceptionLayoutStore(remoteLayout);
    } else {
      const local = loadReceptionLayoutStore();
      setReceptionRows(local.rows);
      setReceptionMastersConfig(local.masters);
      setReceptionUpcomingConfig(local.upcoming);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const salonDayStart = useMemo(() => salonDayStartUtc(bookYmd), [bookYmd]);
  const selectedDay = salonDayStart;

  const firstBookableYmd = useMemo(() => salonFirstBookableYmd(new Date(nowTick)), [nowTick]);
  const monthStart = useMemo(() => startOfMonth(viewMonth), [viewMonth]);
  const monthLabel = useMemo(() => format(monthStart, "LLLL yyyy"), [monthStart]);
  const calendarDays = useMemo(() => {
    const from = startOfWeek(monthStart, { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [monthStart]);

  const mastersPanelStaff = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staffDirectory.map((m) => [m.id, m]));
      const ids = [
        ...new Set([...receptionMastersConfig.hairStaffIds, ...receptionMastersConfig.nailsStaffIds]),
      ];
      return ids
        .map((id) => byId.get(id))
        .filter((m): m is StaffMember => m != null && isStaffShownOnPublicMarketing(m));
    }
    return publicBookableStaffMembers(staff, links, services);
  }, [
    receptionMastersConfig.assignment,
    receptionMastersConfig.hairStaffIds,
    receptionMastersConfig.nailsStaffIds,
    staffDirectory,
    staff,
    links,
    services,
  ]);

  const mastersSplitResolved = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staffDirectory.map((m) => [m.id, m]));
      const pick = (ids: string[]) =>
        ids
          .map((id) => byId.get(id))
          .filter((m): m is StaffMember => m != null && isStaffShownOnPublicMarketing(m));
      return {
        hair: pick(receptionMastersConfig.hairStaffIds),
        nails: pick(receptionMastersConfig.nailsStaffIds),
      };
    }
    return splitStaffIntoHairAndNails(mastersPanelStaff, links, services);
  }, [receptionMastersConfig, staffDirectory, mastersPanelStaff, links, services]);

  const eligibleStaff = useMemo(() => {
    if (serviceId == null) return [];
    const base = staffEligibleForService(staffDirectory, links, serviceId);
    const afterPublic = applyPublicStaffVisibility(base, links, serviceId);
    const svcEntry = services.find((s) => s.id === serviceId);
    return restrictAndOrderStaffByServiceHall(afterPublic, svcEntry, mastersSplitResolved, mastersPanelStaff);
  }, [
    staffDirectory,
    links,
    serviceId,
    mastersPanelStaff,
    mastersSplitResolved,
    services,
  ]);

  const panelServiceIds = useMemo(() => {
    const out = new Set<string>();
    for (const m of mastersPanelStaff) {
      const ids = publicServiceIdsForStaff(m, links, services);
      for (const id of ids) out.add(id);
    }
    return out;
  }, [mastersPanelStaff, links, services]);

  const masterPanelColorAssignments = useMemo(
    () => buildStaffColorAssignments(mastersPanelStaff.map((m) => m.id)),
    [mastersPanelStaff],
  );

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured() || serviceId == null) return;
    const eligibleIds = mastersPanelStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setAppointments([]);
      setTimeOff([]);
      return;
    }
    const start = salonDayStartUtc(bookYmd);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", start.toISOString())
        .lt("start_time", end.toISOString())
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
  }, [bookYmd, mastersPanelStaff, serviceId]);

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
    const panelIds = mastersPanelStaff.map((s) => s.id);
    if (!panelIds.length) {
      setCalendarRangeAppointments([]);
      setCalendarRangeTimeOff([]);
      return;
    }
    const { from, to } = getCalendarDataRange(calendarScope, viewMonth, selectedDay);
    const rangeStartUtc = startOfDay(from).toISOString();
    const rangeEndUtc = endOfDay(to).toISOString();
    const [ap, toff] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", panelIds)
        .gte("start_time", rangeStartUtc)
        .lte("start_time", rangeEndUtc)
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", panelIds)
        .lte("start_time", rangeEndUtc)
        .gte("end_time", rangeStartUtc),
    ]);
    if (ap.data) setCalendarRangeAppointments(ap.data as AppointmentRow[]);
    if (toff.data) {
      setCalendarRangeTimeOff(
        (toff.data as Array<{ staff_id: string; start_time: string; end_time: string }>).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        }))
      );
    }
  }, [calendarScope, mastersPanelStaff, serviceId, selectedDay, viewMonth]);

  useEffect(() => {
    void loadCalendarRangeData();
  }, [loadCalendarRangeData]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const min = salonFirstBookableYmd(new Date(nowTick));
    if (compareSalonYmd(bookYmd, min) < 0) {
      setDayStr(min);
      const [y, m] = min.split("-").map(Number);
      setViewMonth(new Date(y, m - 1, 1));
      setPickedStart(null);
    }
  }, [nowTick, bookYmd]);

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
        day: salonDayStart,
        salonDayStartUtc: salonDayStart,
        salonWeekdaySun0: salonWeekdaySun0(bookYmd),
        stepMinutes: 15,
        staffId: member.id,
      });
      const slots = rawSlots.filter((s) => s.start.getTime() >= nowTick);
      out.set(member.id, slots);
    }
    return out;
  }, [appointments, bookYmd, durationMin, eligibleStaff, schedules, salonDayStart, svc, timeOff, nowTick]);

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

  const slotStaffLabelsByStart = useMemo(() => {
    const out = new Map<string, string>();
    const maxShown = 2;
    for (const iso of slotCoverage.keys()) {
      const names: string[] = [];
      for (const m of eligibleStaff) {
        const staffSlots = slotsByStaff.get(m.id);
        if (staffSlots?.some((s) => s.start.toISOString() === iso)) names.push(m.name);
      }
      if (!names.length) continue;
      const label =
        names.length <= maxShown
          ? names.join(", ")
          : `${names.slice(0, maxShown).join(", ")} +${names.length - maxShown}`;
      out.set(iso, label);
    }
    return out;
  }, [slotCoverage, slotsByStaff, eligibleStaff]);

  const earliestAcrossMastersSlot = useMemo(() => {
    let best: Slot | null = null;
    for (const m of eligibleStaff) {
      const arr = slotsByStaff.get(m.id);
      if (!arr?.length) continue;
      const first = arr[0];
      if (!best || first.start.getTime() < best.start.getTime()) best = first;
    }
    return best;
  }, [eligibleStaff, slotsByStaff]);

  const earliestAcrossMastersLabel = earliestAcrossMastersSlot
    ? format(earliestAcrossMastersSlot.start, "HH:mm")
    : null;

  const pickEarliestAcrossMasters = useCallback(() => {
    if (!earliestAcrossMastersSlot) return;
    setStaffId(ANY_MASTER_ID);
    setPickedStart(earliestAcrossMastersSlot.start);
  }, [earliestAcrossMastersSlot]);

  const dayAvailabilityBadge = useMemo(() => {
    const out = new Map<
      string,
      {
        free: number;
        working: number;
      }
    >();
    if (!svc || !eligibleStaff.length) return out;

    const daysInRange = eachDayInDataRange(calendarScope, viewMonth, selectedDay);
    const tallinnTodayYmd = salonCalendarYmd(new Date(nowTick));
    for (const d of daysInRange) {
      const key = salonYmdFromAnyDate(d);
      const weekday = salonWeekdaySun0(key);
      const dayStart = salonDayStartUtc(key);
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
          day: dayStart,
          salonDayStartUtc: dayStart,
          salonWeekdaySun0: weekday,
          stepMinutes: 15,
          staffId: m.id,
        });
        const slotsForDay = rawSlotsForDay.filter((s) =>
          key === tallinnTodayYmd ? s.start.getTime() >= nowTick : true
        );
        if (slotsForDay.length > 0) free++;
      }

      out.set(key, { free, working });
    }
    return out;
  }, [
    calendarScope,
    viewMonth,
    selectedDay,
    durationMin,
    eligibleStaff,
    calendarRangeAppointments,
    calendarRangeTimeOff,
    schedules,
    svc,
    nowTick,
  ]);

  const appointmentsByDateKey = useMemo(() => {
    const m = new Map<string, AppointmentRow[]>();
    for (const ap of calendarRangeAppointments) {
      if (ap.status === "cancelled") continue;
      const k = salonYmdFromAnyDate(new Date(ap.start_time));
      const arr = m.get(k) ?? [];
      arr.push(ap);
      m.set(k, arr);
    }
    return m;
  }, [calendarRangeAppointments]);

  const staffColorAssignments = useMemo(
    () =>
      buildStaffColorAssignments(
        calendarRangeAppointments.filter((a) => a.status !== "cancelled").map((a) => a.staff_id),
      ),
    [calendarRangeAppointments],
  );

  const staffById = useMemo(() => new Map(staffDirectory.map((s) => [s.id, s])), [staffDirectory]);

  const calendarWeekDays = useMemo(() => {
    const wd = salonWeekdaySun0(bookYmd);
    const fromMonday = (wd + 6) % 7;
    const weekStartYmd = gregorianAddDays(bookYmd, -fromMonday);
    return Array.from({ length: 7 }, (_, i) => salonDayStartUtc(gregorianAddDays(weekStartYmd, i)));
  }, [bookYmd]);

  const calendarRangeTitle = useMemo(() => {
    switch (calendarScope) {
      case "day":
        return new Intl.DateTimeFormat(i18n.language, {
          timeZone: SALON_TIME_ZONE,
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(salonDayStartUtc(bookYmd));
      case "week": {
        const a = calendarWeekDays[0];
        const b = calendarWeekDays[6];
        const fa = new Intl.DateTimeFormat(i18n.language, {
          timeZone: SALON_TIME_ZONE,
          day: "numeric",
          month: "short",
        });
        const fb = new Intl.DateTimeFormat(i18n.language, {
          timeZone: SALON_TIME_ZONE,
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        return `${fa.format(a)} – ${fb.format(b)}`;
      }
      case "month":
        return monthLabel;
      case "quarter":
        return `Q${Math.floor(viewMonth.getMonth() / 3) + 1} ${format(viewMonth, "yyyy")}`;
      case "year":
        return format(startOfYear(viewMonth), "yyyy");
      default:
        return monthLabel;
    }
  }, [calendarScope, calendarWeekDays, bookYmd, i18n.language, monthLabel, viewMonth]);

  const navigateCalendar = useCallback(
    (dir: -1 | 1) => {
      const d = dir;
      if (calendarScope === "day") {
        const next = gregorianAddDays(bookYmd, d);
        const min = salonFirstBookableYmd();
        if (compareSalonYmd(next, min) < 0) return;
        setDayStr(next);
        const [y, m] = next.split("-").map(Number);
        setViewMonth(new Date(y, m - 1, 1));
        return;
      }
      if (calendarScope === "week") {
        const next = gregorianAddDays(bookYmd, d * 7);
        const min = salonFirstBookableYmd();
        const clamped = compareSalonYmd(next, min) < 0 ? min : next;
        setDayStr(clamped);
        const [y, m] = clamped.split("-").map(Number);
        setViewMonth(new Date(y, m - 1, 1));
        return;
      }
      if (calendarScope === "month") {
        setViewMonth((v) => addMonths(v, d));
        return;
      }
      if (calendarScope === "quarter") {
        setViewMonth((v) => addMonths(v, d * 3));
        return;
      }
      setViewMonth((v) => addYears(v, d));
    },
    [calendarScope, bookYmd],
  );

  const onSelectCalendarDay = useCallback((d: Date) => {
    const ymd = salonYmdFromAnyDate(d);
    if (!isSalonBookableYmd(ymd)) return;
    setDayStr(ymd);
    const [y, m] = ymd.split("-").map(Number);
    setViewMonth(new Date(y, m - 1, 1));
    setPickedStart(null);
  }, []);

  const mastersByColumn = useMemo(() => {
    const weekday = salonWeekdaySun0(bookYmd);
    const mapRow = (m: StaffMember): MasterDayRow => {
      const daySchedule = schedules
        .filter((s) => s.staff_id === m.id && s.day_of_week === weekday)
        .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
      const workTime =
        daySchedule.length > 0
          ? `${String(daySchedule[0].start_time || "").slice(0, 5)}–${String(
              daySchedule[daySchedule.length - 1].end_time || ""
            ).slice(0, 5)}`
          : "выходной";
      const staffSlots = slotsByStaff.get(m.id) ?? [];
      const freeSlots = staffSlots.length;
      const freeMinutesUnion = quickBookMergedFreeMinutes(staffSlots, nowTick);
      const earliest = staffSlots[0]?.start ?? null;
      const earliestFreeLabel = earliest ? format(earliest, "HH:mm") : null;
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
        freeMinutesUnion,
        busyItems,
        timeOffItems,
        status,
        earliestFreeLabel,
      };
    };
    const hairRows = mastersSplitResolved.hair.map(mapRow);
    const nailsRows = mastersSplitResolved.nails.map(mapRow);
    const manual = receptionMastersConfig.assignment === "manual";
    return {
      hair: manual ? hairRows : [...hairRows].sort(sortMasterDayRows),
      nails: manual ? nailsRows : [...nailsRows].sort(sortMasterDayRows),
    };
  }, [
    appointments,
    bookYmd,
    mastersSplitResolved,
    receptionMastersConfig.assignment,
    schedules,
    slotsByStaff,
    timeOff,
    nowTick,
  ]);

  const highlightServiceIds = useMemo(() => {
    if (!staffId || staffId === ANY_MASTER_ID) return new Set<string>();
    const member = staffDirectory.find((s) => s.id === staffId);
    if (!member) return new Set<string>();
    return publicServiceIdsForStaff(member, links, services);
  }, [staffId, staffDirectory, links, services]);

  const pickMaster = useCallback(
    (masterId: string) => {
      setStaffId(masterId);
      setPickedStart(null);
      const member = staffDirectory.find((s) => s.id === masterId);
      if (!member) return;
      const ids = publicServiceIdsForStaff(member, links, services);
      if (serviceId != null && !ids.has(serviceId)) {
        const first = services.find((s) => s.active && ids.has(s.id));
        if (first) setServiceId(first.id);
      }
    },
    [staffDirectory, links, services, serviceId],
  );

  const receptionUpcoming = useMemo(() => {
    const allowedStaffIds = new Set(mastersPanelStaff.map((s) => s.id));
    return upcomingAppointments
      .filter((a) => allowedStaffIds.has(a.staff_id))
      .slice(0, 48);
  }, [mastersPanelStaff, upcomingAppointments]);

  async function confirmBook() {
    const normalizedClientName = clientName.trim();
    if (!svc || !pickedStart || !normalizedClientName) {
      setMsg(t("publicBook.fillAll"));
      return;
    }
    if (!isSalonBookableYmd(bookYmd)) {
      setMsg(t("publicBook.dayNotBookable"));
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
    const noteTrim = clientNote.trim();
    try {
      const { data, error: fnError } = await supabase.functions.invoke("google-calendar-sync", {
        body: {
          mode: "website_booking",
          staffId: finalStaffId,
          serviceId: svc.id,
          clientName: normalizedClientName || "Клиент",
          clientPhone: clientPhone.trim() || "",
          startTime: pickedStart.toISOString(),
          endTime: end.toISOString(),
          ...(noteTrim ? { note: noteTrim } : {}),
        },
      });
      setBooking(false);
      if (fnError) {
        setMsg(fnError.message || "Не удалось связаться с сервером записи.");
        return;
      }
      const payload = (data ?? {}) as { ok?: boolean; error?: string };
      if (payload.ok !== true) {
        const errText = String(payload.error ?? "Запись не создана.");
        setMsg(errText);
        if (/slot|занят|no longer available/i.test(errText)) {
          void loadDayData();
          void loadCalendarRangeData();
        }
        return;
      }
      setMsg(t("publicBook.success"));
    } catch {
      setBooking(false);
      setMsg("Ошибка сети. Проверьте подключение и попробуйте снова.");
      return;
    }
    setPickedStart(null);
    setClientName("");
    setClientPhone("");
    setClientNote("");
    void loadDayData();
    void loadCalendarRangeData();
    void loadUpcomingData();
  }

  function renderDayButtons(gridDays: Date[], anchorMonth: Date, compact: boolean) {
    return gridDays.map((d) => {
      const cellYmd = salonYmdFromAnyDate(d);
      const selected = cellYmd === bookYmd;
      const todayTallinn = salonCalendarYmd(new Date(nowTick));
      const isTodayCell = cellYmd === todayTallinn;
      const inMonth = isSameMonth(d, anchorMonth);
      const cov = dayAvailabilityBadge.get(cellYmd);
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

      const disabled = compareSalonYmd(cellYmd, firstBookableYmd) < 0;

      let stateClass: string;
      if (disabled) {
        stateClass = "cursor-not-allowed border-zinc-900/80 bg-zinc-950/80 text-zinc-600 opacity-50";
      } else if (selected && isTodayCell) {
        stateClass =
          "border-sky-500 bg-sky-950/50 text-white ring-2 ring-emerald-400/45 ring-offset-2 ring-offset-zinc-950";
      } else if (selected) {
        stateClass = "border-sky-500 bg-sky-950/50 text-white";
      } else if (isTodayCell) {
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
          disabled={disabled}
          aria-disabled={disabled}
          aria-current={isTodayCell ? "date" : undefined}
          title={
            disabled
              ? t("publicBook.pastDayNotSelectable")
              : isTodayCell
                ? t("publicBook.todayMarker")
                : undefined
          }
          onClick={() => {
            if (!disabled) onSelectCalendarDay(d);
          }}
          className={`rounded-md border transition ${sizeClass} ${stateClass}`}
        >
          <span className="block">{format(d, "d")}</span>
          {inMonth && cov && (
            <span className={`mt-0.5 block ${compact ? "text-[9px] leading-tight" : "text-[10px]"} ${tone}`}>
              {cov.working > 0 ? `${cov.free}/${cov.working}` : "—"}
            </span>
          )}
          {(() => {
            const dk = cellYmd;
            const apList = appointmentsByDateKey.get(dk) ?? [];
            const staffIds = [...new Set(apList.map((a) => a.staff_id))].slice(0, 6);
            if (staffIds.length === 0) return null;
            return (
              <div
                className="mt-0.5 flex flex-wrap justify-center gap-0.5"
                title={t("publicBook.calendarStaffDotsTitle")}
              >
                {staffIds.map((id) => {
                  const look = resolveStaffPublicCalendarLook(id, staffById, staffColorAssignments);
                  return (
                    <span
                      key={id}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${look.kind === "palette" ? look.palette.dot : ""}`}
                      style={look.kind === "google" ? { backgroundColor: look.bg } : undefined}
                      title={staffById.get(id)?.name ?? ""}
                    />
                  );
                })}
              </div>
            );
          })()}
        </button>
      );
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
        i18n={i18n}
        calendarScope={calendarScope}
        setCalendarScope={setCalendarScope}
        viewMonth={viewMonth}
        setViewMonth={setViewMonth}
        selectedDay={selectedDay}
        selectedDayYmd={bookYmd}
        minSelectableYmd={firstBookableYmd}
        onSelectCalendarDay={onSelectCalendarDay}
        monthStart={monthStart}
        calendarDays={calendarDays}
        weekDays={calendarWeekDays}
        rangeTitle={calendarRangeTitle}
        onNavigatePrev={() => navigateCalendar(-1)}
        onNavigateNext={() => navigateCalendar(1)}
        renderDayButtons={renderDayButtons}
        calendarRangeAppointments={calendarRangeAppointments}
        staffColorAssignments={staffColorAssignments}
        staffById={staffById}
        services={services}
        timelineStaff={mastersPanelStaff}
        schedules={schedules}
        implicitWeekExceptSundayStaffIds={implicitWeekExceptSundayStaffIds}
      />
    ),
    upcoming: (
      <PublicBookingUpcomingSection
        receptionUpcoming={receptionUpcoming}
        mastersPanelStaff={mastersPanelStaff}
        staffById={staffById}
        staffColorAssignments={masterPanelColorAssignments}
        services={services}
        i18n={i18n}
        t={t}
        density={receptionUpcomingConfig.density}
        contentWidth={receptionUpcomingConfig.pairColumn}
      />
    ),
    masters:
      serviceId != null ? (
        <PublicBookingMastersSection
          t={t}
          hairMasters={mastersByColumn.hair}
          nailMasters={mastersByColumn.nails}
          selectedStaffId={staffId !== ANY_MASTER_ID ? staffId : null}
          onPickMaster={pickMaster}
          density={receptionMastersConfig.density}
          mastersLayout={receptionMastersConfig.mastersLayout}
          staffById={staffById}
          staffColorAssignments={masterPanelColorAssignments}
        />
      ) : null,
    booking:
      serviceId != null ? (
        <PublicBookingBookingSection
          t={t}
          i18n={i18n}
          isReceptionMode={false}
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
          clientNote={clientNote}
          setClientNote={setClientNote}
          booking={booking}
          confirmBook={confirmBook}
          eligibleStaff={eligibleStaff}
          highlightServiceIds={highlightServiceIds}
          panelServiceIds={panelServiceIds}
          slotStaffLabelsByStart={slotStaffLabelsByStart}
          onPickEarliestAcrossMasters={pickEarliestAcrossMasters}
          earliestAcrossMastersLabel={earliestAcrossMastersLabel}
        />
      ) : null,
  };

  const mainContent = renderReceptionRows(receptionRows, receptionSections, {
    upcoming: receptionUpcomingConfig,
  });

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-200 md:px-6 md:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-2xl font-semibold text-white md:text-3xl">{t("publicBook.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("publicBook.subtitle")}</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
          <Link to="/login" className="inline-block text-sm text-sky-400">
            {t("publicBook.staffLogin")}
          </Link>
          <Link
            to="/book/simple"
            className="inline-block text-sm text-zinc-400 hover:text-sky-400"
          >
            {t("simpleBook.shortFormLink", { defaultValue: "Короткая форма записи" })}
          </Link>
          <Link
            to="/calendar"
            className="inline-block text-sm font-medium text-emerald-300 hover:text-emerald-200"
          >
            {t("publicBook.receptionCalendarLink")}
          </Link>
          <Link
            to="/help"
            className="inline-block text-sm font-medium text-violet-300 hover:text-violet-200"
          >
            {t("publicBook.receptionSupportLoginCta")}
          </Link>
        </div>

        {staffMember ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700/80 bg-zinc-900/60 px-3 py-2.5 text-sm">
            <Link to="/" className="font-medium text-sky-400 transition hover:text-sky-300">
              ← {t("nav.backToCrm")}
            </Link>
            <span className="hidden text-zinc-600 sm:inline" aria-hidden="true">
              ·
            </span>
            <Link
              to="/calendar"
              className="font-medium text-emerald-300 transition hover:text-emerald-200"
            >
              {t("publicBook.receptionCalendarLink")}
            </Link>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-zinc-600">
          {t("publicBook.layoutEditHint")}{" "}
          <Link to="/admin/site-settings" className="text-sky-400 hover:text-sky-300">
            {t("nav.adminSiteSettings")}
          </Link>
        </p>

        <div className="mt-6 space-y-6 md:mt-8">
          {mainContent}

          {msg && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                msg === t("publicBook.success")
                  ? "border-emerald-500/35 bg-emerald-950/25 text-emerald-100"
                  : "border-amber-500/35 bg-amber-950/20 text-amber-100"
              }`}
            >
              <p className={msg === t("publicBook.success") ? "font-medium text-emerald-200" : ""}>{msg}</p>
              {msg === t("publicBook.success") ? (
                <p className="mt-2 border-t border-emerald-500/20 pt-2 text-xs leading-relaxed text-emerald-100/85">
                  {t("publicBook.successPriceDisclaimer")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
