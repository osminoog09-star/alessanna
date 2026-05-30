import { useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "../../lib/supabase";
import type { StaffMember, StaffScheduleRow, StaffTimeOffRow } from "../../types/database";

const RU_DAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const RU_MONTHS = [
  "января","февраля","марта","апреля","мая","июня",
  "июля","августа","сентября","октября","ноября","декабря",
];

type Props = {
  day: Date;
  anchorX: number;
  anchorY: number;
  allStaff: StaffMember[];
  schedules: StaffScheduleRow[];
  timeOff: StaffTimeOffRow[];
  onClose: () => void;
  onSaved: () => void;
};

function hasScheduleForDay(staffId: string, dayOfWeek: number, schedules: StaffScheduleRow[]) {
  return schedules.some((s) => s.staff_id === staffId && Number(s.day_of_week) === dayOfWeek);
}

function fullDayTimeOffIds(staffId: string, date: Date, timeOff: StaffTimeOffRow[]): string[] {
  const dateStr = format(date, "yyyy-MM-dd");
  return timeOff
    .filter((r) => r.staff_id === staffId && r.start_time.startsWith(dateStr))
    .map((r) => r.id);
}

export function DaySchedulePopup({ day, anchorX, anchorY, allStaff, schedules, timeOff, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState<string | null>(null);

  const x = Math.min(anchorX + 8, window.innerWidth - 290);
  const y = Math.min(anchorY, window.innerHeight - 420);
  const dayOfWeek = day.getDay();
  const dayLabel = `${RU_DAYS[dayOfWeek]}, ${day.getDate()} ${RU_MONTHS[day.getMonth()]}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(staffId: string, currentlyWorking: boolean) {
    setSaving(staffId);
    const dateStr = format(day, "yyyy-MM-dd");
    if (currentlyWorking) {
      await supabase.from("staff_time_off").insert({
        staff_id: staffId,
        start_time: `${dateStr}T00:00:00`,
        end_time: `${dateStr}T23:59:59`,
        reason: null,
      });
    } else {
      const ids = fullDayTimeOffIds(staffId, day, timeOff);
      if (ids.length) {
        await supabase.from("staff_time_off").delete().in("id", ids);
      }
    }
    setSaving(null);
    onSaved();
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-64 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#dadce0] px-4 py-3">
          <span className="text-sm font-medium capitalize text-[#3c4043]">{dayLabel}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#70757a] hover:bg-[#f1f3f4]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-1 py-2">
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[#70757a]">
            Работает в этот день
          </p>
          {allStaff.map((m) => {
            const isScheduled = hasScheduleForDay(m.id, dayOfWeek, schedules);
            const hasTimeOff = fullDayTimeOffIds(m.id, day, timeOff).length > 0;
            const isWorking = isScheduled && !hasTimeOff;
            const isLoading = saving === m.id;

            return (
              <label
                key={m.id}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors",
                  isScheduled ? "hover:bg-[#f1f3f4]" : "cursor-default opacity-40",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={isWorking}
                  disabled={!isScheduled || isLoading}
                  onChange={() => { void toggle(m.id, isWorking); }}
                  className="h-4 w-4 accent-[#1a73e8]"
                />
                <span className="flex-1 text-sm text-[#3c4043]">{m.name}</span>
                {!isScheduled && (
                  <span className="text-[10px] text-[#70757a]">нет расписания</span>
                )}
                {isLoading && (
                  <span className="text-[10px] text-[#70757a]">…</span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </>
  );
}
