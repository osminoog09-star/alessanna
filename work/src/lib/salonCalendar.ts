import { addMinutes, startOfDay } from "date-fns";
import { appointmentInterval, intervalsOverlap, workingWindowsForWeekday } from "./slots";
import type { StaffScheduleRow } from "../types/database";
import type { WeeklyScheduleLike } from "./slots";

export type MinuteWindow = { start: number; end: number };

/** Minutes from midnight for a date on its local calendar day. */
export function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function gridBounds(day: Date, startHour: number, endHour: number) {
  const sod = startOfDay(day).getTime();
  return {
    g0: sod + startHour * 3600000,
    g1: sod + endHour * 3600000,
  };
}

export function blockPercentStyle(
  start: Date,
  end: Date,
  day: Date,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const { g0, g1 } = gridBounds(day, startHour, endHour);
  const total = g1 - g0;
  if (total <= 0) return { top: "0%", height: "0%" };
  const top = ((start.getTime() - g0) / total) * 100;
  const height = ((end.getTime() - start.getTime()) / total) * 100;
  return {
    top: `${Math.max(0, Math.min(100, top))}%`,
    height: `${Math.max(0.4, Math.min(100 - top, height))}%`,
  };
}

export function workingMinuteWindowsForDay(
  schedules: StaffScheduleRow[],
  staffId: string,
  weekday: number
): MinuteWindow[] {
  const mine = schedules
    .filter((s) => s.staff_id === staffId)
    .map((s) => ({
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    })) as WeeklyScheduleLike[];
  return workingWindowsForWeekday(mine, weekday);
}

/** Convert grid-relative windows (minutes from midnight) to absolute ms range on `day`. */
export function windowsToDayRanges(day: Date, windows: MinuteWindow[]): { start: Date; end: Date }[] {
  const sod = startOfDay(day);
  return windows.map((w) => ({
    start: addMinutes(sod, w.start),
    end: addMinutes(sod, w.end),
  }));
}

export function isIntervalInsideWorkingWindows(
  start: Date,
  end: Date,
  windows: MinuteWindow[],
  day: Date
): boolean {
  if (windows.length === 0) return false;
  const ranges = windowsToDayRanges(day, windows);
  return ranges.some((r) => start >= r.start && end <= r.end);
}

export function overlapsAnyWindow(start: Date, end: Date, windows: { start: Date; end: Date }[]): boolean {
  for (const w of windows) {
    if (intervalsOverlap(start, end, w.start, w.end)) return true;
  }
  return false;
}

export function clickToSnappedDate(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  day: Date,
  startHour: number,
  endHour: number,
  snapMinutes: number
): Date {
  const y = Math.max(0, Math.min(rectHeight, clientY - rectTop));
  const ratio = rectHeight > 0 ? y / rectHeight : 0;
  const totalMin = (endHour - startHour) * 60;
  let mins = startHour * 60 + ratio * totalMin;
  mins = Math.round(mins / snapMinutes) * snapMinutes;
  mins = Math.max(startHour * 60, Math.min(endHour * 60, mins));
  return addMinutes(startOfDay(day), mins);
}

export function overlapsTimeOff(
  start: Date,
  end: Date,
  staffId: string,
  timeOffRows: Array<{ staff_id: string; start_time: string; end_time: string }>
): boolean {
  for (const t of timeOffRows) {
    if (t.staff_id !== staffId) continue;
    const iv = appointmentInterval({ start_time: t.start_time, end_time: t.end_time });
    if (!iv) continue;
    if (intervalsOverlap(start, end, iv.start, iv.end)) return true;
  }
  return false;
}
