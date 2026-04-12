import { addMinutes, format, parseISO, startOfDay, isWithinInterval } from "date-fns";

export type WeeklyScheduleLike = {
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type AppointmentLike = {
  start_time: string;
  end_time: string;
};

function minutesFromTime(t: string): number {
  const part = t.slice(0, 5);
  const [h, m] = part.split(":").map(Number);
  return h * 60 + m;
}

function mergeWindows(windows: { start: number; end: number }[]): { start: number; end: number }[] {
  if (!windows.length) return [];
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.start <= cur.end) cur.end = Math.max(cur.end, w.end);
    else {
      out.push(cur);
      cur = { ...w };
    }
  }
  out.push(cur);
  return out;
}

/** Working windows for a weekday (0–6, JS Sunday=0) from weekly schedule rows. */
export function workingWindowsForWeekday(schedule: WeeklyScheduleLike[], weekday: number) {
  const raw = schedule
    .filter((s) => s.day_of_week === weekday)
    .map((s) => ({
      start: minutesFromTime(s.start_time),
      end: minutesFromTime(s.end_time),
    }));
  return mergeWindows(raw);
}

export function appointmentInterval(a: AppointmentLike): { start: Date; end: Date } | null {
  try {
    const start = parseISO(a.start_time);
    const end = parseISO(a.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end };
  } catch {
    return null;
  }
}

/** Legacy alias for booking-shaped rows */
export function bookingInterval(b: {
  appointment_at?: string | null;
  start_at?: string;
  end_at?: string;
  start_time?: string;
  end_time?: string;
}): { start: Date; end: Date } | null {
  const startIso = b.start_time ?? b.appointment_at ?? b.start_at;
  const endIso = b.end_time ?? b.end_at;
  if (!startIso || !endIso) return null;
  return appointmentInterval({ start_time: startIso, end_time: endIso });
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function overlapsExistingAppointments(
  candStart: Date,
  candEnd: Date,
  rows: AppointmentLike[]
): boolean {
  for (const b of rows) {
    const iv = appointmentInterval(b);
    if (!iv) continue;
    if (intervalsOverlap(candStart, candEnd, iv.start, iv.end)) return true;
  }
  return false;
}

export function appointmentsForStaffOnDay(
  appointments: Array<AppointmentLike & { staff_id: string }>,
  staffId: string,
  day: Date
): { start: Date; end: Date }[] {
  const d0 = startOfDay(day);
  const d1 = addMinutes(d0, 24 * 60 - 1);
  return appointments
    .filter((b) => b.staff_id === staffId)
    .map((b) => appointmentInterval(b))
    .filter((x): x is { start: Date; end: Date } => x !== null)
    .filter(({ start }) => isWithinInterval(start, { start: d0, end: d1 }));
}

export type Slot = {
  start: Date;
  end: Date;
  available: boolean;
};

export function buildSlotsForDay(
  day: Date,
  weekday: number,
  schedule: WeeklyScheduleLike[],
  existing: { start: Date; end: Date }[],
  durationMin: number,
  stepMin: number
): Slot[] {
  const windows = workingWindowsForWeekday(schedule, weekday);
  const slots: Slot[] = [];
  const base = startOfDay(day);

  for (const w of windows) {
    for (let m = w.start; m + durationMin <= w.end; m += stepMin) {
      const start = addMinutes(base, m);
      const end = addMinutes(start, durationMin);
      const clash = existing.some((ex) => start < ex.end && end > ex.start);
      slots.push({ start, end, available: !clash });
    }
  }
  return slots;
}

export function formatSlotRange(s: Slot): string {
  return `${format(s.start, "HH:mm")}–${format(s.end, "HH:mm")}`;
}

export type GenerateSlotsParams = {
  schedule: WeeklyScheduleLike[];
  appointments: Array<AppointmentLike & { staff_id: string }>;
  timeOff: Array<AppointmentLike & { staff_id: string }>;
  duration: number;
  /** Calendar day to generate for */
  day: Date;
  /** Slot step (minutes). Default 15. */
  stepMinutes?: number;
  staffId: string;
};

/**
 * Build available slots from weekly schedule, excluding overlaps with appointments and time off.
 */
export function generateAvailableSlots(params: GenerateSlotsParams): Slot[] {
  const {
    schedule,
    appointments,
    timeOff,
    duration,
    day,
    stepMinutes = 15,
    staffId,
  } = params;
  const weekday = day.getDay();
  const busy: { start: Date; end: Date }[] = [
    ...appointmentsForStaffOnDay(appointments, staffId, day),
    ...appointmentsForStaffOnDay(timeOff as Array<AppointmentLike & { staff_id: string }>, staffId, day),
  ];
  return buildSlotsForDay(day, weekday, schedule, busy, duration, stepMinutes).filter((s) => s.available);
}
