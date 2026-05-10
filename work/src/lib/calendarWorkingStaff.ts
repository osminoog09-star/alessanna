import type { StaffMember, StaffScheduleRow } from "../types/database";

/**
 * Ключ `salon_settings`: JSON-массив uuid мастеров, которые по смыслу работают пн–сб,
 * если в `staff_schedule` для них нет ни одной строки (например, не синхронизировались из Google).
 */
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
 * по списку «пн–сб» из настроек (только если у мастера нет ни одной строки расписания).
 */
export function panelStaffWorkingOnDate(
  panelStaff: StaffMember[],
  schedules: StaffScheduleRow[],
  day: Date,
  implicitWeekExceptSundayStaffIds: ReadonlySet<string>,
): StaffMember[] {
  const wd = day.getDay();
  return panelStaff
    .filter((m) => {
      const rows = schedules.filter((s) => s.staff_id === m.id);
      if (rows.length > 0) {
        return rows.some((s) => Number(s.day_of_week) === wd);
      }
      if (wd === 0) return false;
      return implicitWeekExceptSundayStaffIds.has(m.id);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "et", { sensitivity: "base" }));
}
