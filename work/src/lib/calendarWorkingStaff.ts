import { parseISO, startOfDay, endOfDay } from "date-fns";
import type { StaffMember, StaffScheduleRow, StaffTimeOffRow } from "../types/database";

export const CALENDAR_WEEK_EXCEPT_SUNDAY_STAFF_SETTING_KEY = "calendar_week_except_sunday_staff_ids";

export function parseStaffIdJsonList(raw: string | null | undefined): string[] {
  if (raw == null || String(raw).trim() === "") return [];
  try {
    const p = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * Мастера с панели, у которых сегодня смена: по строкам `staff_schedule`, иначе —
 * по списку «пн–сб» из настроек. Если передан `timeOff`, мастера у которых есть
 * запись time_off покрывающая этот день — исключаются (выходной/отгул).
 */
export function panelStaffWorkingOnDate(
  panelStaff: StaffMember[],
  schedules: StaffScheduleRow[],
  day: Date,
  implicitWeekExceptSundayStaffIds: ReadonlySet<string>,
  timeOff?: StaffTimeOffRow[],
): StaffMember[] {
  const wd = day.getDay();
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  return panelStaff
    .filter((m) => {
      const rows = schedules.filter((s) => s.staff_id === m.id);
      let isScheduled: boolean;
      if (rows.length > 0) {
        isScheduled = rows.some((s) => Number(s.day_of_week) === wd);
      } else {
        isScheduled = wd !== 0 && implicitWeekExceptSundayStaffIds.has(m.id);
      }
      if (!isScheduled) return false;

      if (timeOff) {
        const hasTimeOff = timeOff.some((t) => {
          if (t.staff_id !== m.id) return false;
          const start = parseISO(t.start_time);
          const end = parseISO(t.end_time);
          return start <= dayEnd && end >= dayStart;
        });
        if (hasTimeOff) return false;
      }

      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "et", { sensitivity: "base" }));
}
