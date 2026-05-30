import { useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import type { StaffMember } from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { googleStaffColor } from "./receptionColors";

type Props = {
  cursor: Date;
  onDateSelect: (date: Date) => void;
  staff: StaffMember[];
  visibleStaffIds: Set<string>;
  onToggleStaff: (id: string) => void;
};

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function ReceptionSidebar({
  cursor,
  onDateSelect,
  staff,
  visibleStaffIds,
  onToggleStaff,
}: Props) {
  const [miniCursor, setMiniCursor] = useState(() => new Date());
  const today = new Date();
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  const monthStart = startOfMonth(miniCursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const miniDays = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[#dadce0] bg-white py-3">
      {/* Mini calendar */}
      <div className="px-3">
        <div className="mb-1 flex items-center justify-between">
          <button
            onClick={() => setMiniCursor((d) => subMonths(d, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label="Предыдущий месяц"
          >
            ‹
          </button>
          <span className="text-xs font-medium capitalize text-[#3c4043]">
            {miniCursor.toLocaleString("ru-RU", { month: "long", year: "numeric" })}
          </span>
          <button
            onClick={() => setMiniCursor((d) => addMonths(d, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label="Следующий месяц"
          >
            ›
          </button>
        </div>

        {/* Day name headers */}
        <div className="grid grid-cols-7 text-center">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-0.5 text-[10px] font-medium text-[#70757a]">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 text-center">
          {miniDays.map((day) => {
            const isToday = isSameDay(day, today);
            const isSelected = isSameWeek(day, cursor, { weekStartsOn: 1 });
            const isCurrentMonth = isSameMonth(day, miniCursor);
            return (
              <button
                key={day.toISOString()}
                onClick={() => onDateSelect(day)}
                className={[
                  "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors",
                  isToday
                    ? "bg-[#1a73e8] font-bold text-white"
                    : isSelected && !isToday
                    ? "bg-[#e8f0fe] text-[#1a73e8]"
                    : isCurrentMonth
                    ? "text-[#3c4043] hover:bg-[#f1f3f4]"
                    : "text-[#bdc1c6] hover:bg-[#f1f3f4]",
                ].join(" ")}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-3 my-3 border-t border-[#dadce0]" />

      {/* Staff list */}
      <div className="px-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#70757a]">
          Мастера
        </p>
        <div className="space-y-0.5">
          {staff.map((member) => {
            const c = googleStaffColor(member, staffHueMap);
            const checked = visibleStaffIds.has(member.id);
            return (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f1f3f4]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleStaff(member.id)}
                  className="sr-only"
                />
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm transition-colors"
                  style={{
                    backgroundColor: checked ? c.bg : "transparent",
                    border: `2px solid ${c.bg}`,
                  }}
                >
                  {checked && (
                    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke={c.fg} strokeWidth="2">
                      <polyline points="1.5,5 4,7.5 8.5,2.5" />
                    </svg>
                  )}
                </span>
                <span className="truncate text-sm text-[#3c4043]">{member.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
