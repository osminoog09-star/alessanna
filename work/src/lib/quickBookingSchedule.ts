import {
  compareSalonYmd,
  gregorianAddDays,
  isSalonBookableYmd,
  salonDayStartUtc,
  salonWeekdaySun0,
  salonYmdFromAnyDate,
} from "./bookingSalonTz";
import { generateDaySlots, type Slot } from "./slots";
import type { AppointmentRow, StaffMember, StaffScheduleRow } from "../types/database";

export type QuickBookTimeOffRow = { staff_id: string; start_time: string; end_time: string };

export type QuickBookDayMark = "past" | "closed" | "busy" | "free";

/** Слоты дня (как в мастере визарда): объединение по мастерам или один мастер. */
export function slotsForQuickBookSalonDay(params: {
  ymd: string;
  eligibleStaff: StaffMember[];
  schedules: StaffScheduleRow[];
  appointments: AppointmentRow[];
  timeOff: QuickBookTimeOffRow[];
  durationMin: number;
  staffId: string | null;
  anyMasterToken: string;
}): Slot[] {
  const {
    ymd,
    eligibleStaff,
    schedules,
    appointments,
    timeOff,
    durationMin,
    staffId,
    anyMasterToken,
  } = params;
  const salonDayStart = salonDayStartUtc(ymd);
  const wd = salonWeekdaySun0(ymd);
  const dayApps = appointments.filter(
    (a) => a.status !== "cancelled" && salonYmdFromAnyDate(new Date(a.start_time)) === ymd,
  );
  const dayStartMs = salonDayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  const dayToff = timeOff.filter((t) => {
    const ts = new Date(t.start_time).getTime();
    const te = new Date(t.end_time).getTime();
    return ts < dayEndMs && te > dayStartMs;
  });

  const scheduleRows = (sid: string) =>
    schedules
      .filter((s) => s.staff_id === sid)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }));

  if (staffId && staffId !== anyMasterToken) {
    return generateDaySlots({
      schedule: scheduleRows(staffId),
      appointments: dayApps,
      timeOff: dayToff,
      duration: durationMin,
      day: salonDayStart,
      salonDayStartUtc: salonDayStart,
      salonWeekdaySun0: wd,
      stepMinutes: 15,
      staffId,
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  const byStart = new Map<string, Slot>();
  for (const member of eligibleStaff) {
    const raw = generateDaySlots({
      schedule: scheduleRows(member.id),
      appointments: dayApps,
      timeOff: dayToff,
      duration: durationMin,
      day: salonDayStart,
      salonDayStartUtc: salonDayStart,
      salonWeekdaySun0: wd,
      stepMinutes: 15,
      staffId: member.id,
    });
    for (const s of raw) {
      const key = s.start.toISOString();
      const ex = byStart.get(key);
      if (!ex) byStart.set(key, { ...s });
      else ex.available = ex.available || s.available;
    }
  }
  return Array.from(byStart.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function markQuickBookSalonDay(params: {
  ymd: string;
  firstBookableYmd: string;
  nowTick: number;
  eligibleStaff: StaffMember[];
  schedules: StaffScheduleRow[];
  appointments: AppointmentRow[];
  timeOff: QuickBookTimeOffRow[];
  durationMin: number;
  staffId: string | null;
  anyMasterToken: string;
}): QuickBookDayMark {
  const { ymd, firstBookableYmd, nowTick } = params;
  if (compareSalonYmd(ymd, firstBookableYmd) < 0 || !isSalonBookableYmd(ymd)) return "past";
  const wd = salonWeekdaySun0(ymd);
  const hasHours = params.eligibleStaff.some((m) =>
    params.schedules.some((s) => s.staff_id === m.id && Number(s.day_of_week) === wd),
  );
  if (!hasHours) return "closed";
  const slots = slotsForQuickBookSalonDay({
    ymd,
    eligibleStaff: params.eligibleStaff,
    schedules: params.schedules,
    appointments: params.appointments,
    timeOff: params.timeOff,
    durationMin: params.durationMin,
    staffId: params.staffId,
    anyMasterToken: params.anyMasterToken,
  });
  if (slots.length === 0) return "closed";
  const hasFree = slots.some((s) => s.available && s.start.getTime() >= nowTick);
  return hasFree ? "free" : "busy";
}

export function firstFreeSlotOnDay(
  slots: Slot[],
  nowTick: number,
): Slot | null {
  for (const s of slots) {
    if (s.available && s.start.getTime() >= nowTick) return s;
  }
  return null;
}

/** Сканировать ymd подряд от firstBookable, максимум maxDays. */
export function findFirstQuickBookableYmd(params: {
  firstBookableYmd: string;
  maxDays: number;
  nowTick: number;
  eligibleStaff: StaffMember[];
  schedules: StaffScheduleRow[];
  appointments: AppointmentRow[];
  timeOff: QuickBookTimeOffRow[];
  durationMin: number;
  staffId: string | null;
  anyMasterToken: string;
}): { ymd: string; slot: Slot } | null {
  for (let i = 0; i < params.maxDays; i++) {
    const ymd = gregorianAddDays(params.firstBookableYmd, i);
    if (markQuickBookSalonDay({ ...params, ymd, firstBookableYmd: params.firstBookableYmd }) !== "free") {
      continue;
    }
    const slots = slotsForQuickBookSalonDay({
      ymd,
      eligibleStaff: params.eligibleStaff,
      schedules: params.schedules,
      appointments: params.appointments,
      timeOff: params.timeOff,
      durationMin: params.durationMin,
      staffId: params.staffId,
      anyMasterToken: params.anyMasterToken,
    });
    const slot = firstFreeSlotOnDay(slots, params.nowTick);
    if (slot) return { ymd, slot };
  }
  return null;
}
