import { addMinutes, format, parseISO, startOfDay, isWithinInterval } from "date-fns";

export type ScheduleLike = {
  day: number;
  start_time: string;
  end_time: string;
  status: string;
};

export type BookingLike = {
  appointment_at: string | null;
  start_at: string;
  end_at: string;
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

export function approvedWindowsForWeekday(schedules: ScheduleLike[], weekday: number) {
  const raw = schedules
    .filter((s) => s.day === weekday && s.status === "approved")
    .map((s) => ({
      start: minutesFromTime(s.start_time),
      end: minutesFromTime(s.end_time),
    }));
  return mergeWindows(raw);
}

export function bookingInterval(b: BookingLike): { start: Date; end: Date } | null {
  const iso = b.appointment_at || b.start_at;
  if (!iso) return null;
  try {
    const start = parseISO(iso);
    const end = parseISO(b.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end };
  } catch {
    return null;
  }
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd) (half-open compatible with touching = no overlap at exact boundary). */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Whether a candidate interval clashes with any existing booking row. */
export function overlapsExistingBookings(
  candStart: Date,
  candEnd: Date,
  rows: BookingLike[]
): boolean {
  for (const b of rows) {
    const iv = bookingInterval(b);
    if (!iv) continue;
    if (intervalsOverlap(candStart, candEnd, iv.start, iv.end)) return true;
  }
  return false;
}

export function bookingsForEmployeeOnDay(
  bookings: Array<BookingLike & { employee_id: number }>,
  employeeId: number,
  day: Date
): { start: Date; end: Date }[] {
  const d0 = startOfDay(day);
  const d1 = addMinutes(d0, 24 * 60 - 1);
  return bookings
    .filter((b) => b.employee_id === employeeId)
    .map((b) => bookingInterval(b))
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
  schedules: ScheduleLike[],
  existing: { start: Date; end: Date }[],
  durationMin: number,
  stepMin: number
): Slot[] {
  const windows = approvedWindowsForWeekday(schedules, weekday);
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
