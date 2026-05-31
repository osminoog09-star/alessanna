import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  dark?: boolean;
  hideMiniCalendar?: boolean;
  view?: "day" | "week" | "month";
  onViewChange?: (v: "day" | "week" | "month") => void;
};

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0] as const; // Mon→1 … Sun→0

export function ReceptionSidebar({
  cursor,
  onDateSelect,
  staff,
  visibleStaffIds,
  onToggleStaff,
  dark,
  hideMiniCalendar,
  view,
  onViewChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language.split("-")[0] ?? "ru";
  const uiLocale = currentLang === "et" ? "et-EE" : "ru-RU";
  const [miniCursor, setMiniCursor] = useState(() => new Date());
  const today = new Date();
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  const bg = dark ? "bg-panel" : "bg-white";
  const borderCls = dark ? "border-line/15" : "border-[#dadce0]";
  const mutedCls = dark ? "text-muted" : "text-[#70757a]";
  const textCls = dark ? "text-fg" : "text-[#3c4043]";
  const hoverCls = dark ? "hover:bg-white/5" : "hover:bg-[#f1f3f4]";
  const navBtnCls = dark ? "text-muted hover:bg-white/5" : "text-[#5f6368] hover:bg-[#f1f3f4]";
  const inactiveCls = dark ? "text-muted/40" : "text-[#bdc1c6]";
  const weekSelCls = dark ? "bg-blue-500/15 text-blue-400" : "bg-[#e8f0fe] text-[#1a73e8]";

  const monthStart = startOfMonth(miniCursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const miniDays = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  return (
    <div className={`flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r py-3 ${borderCls} ${bg}`}>
      {/* View switcher — only shown on mobile (top bar hides it on sm) */}
      {onViewChange && view && (
        <div className={`mb-3 flex items-center rounded-lg border p-0.5 mx-3 md:hidden ${borderCls}`}>
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={[
                "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                view === v ? "bg-[#e8f0fe] text-[#1a73e8]" : `${mutedCls} ${hoverCls}`,
              ].join(" ")}
            >
              {v === "day" ? t("calendar.day") : v === "week" ? t("calendar.week") : t("calendar.month")}
            </button>
          ))}
        </div>
      )}

      {!hideMiniCalendar && (
      <>
      {/* Mini calendar */}
      <div className="px-3">
        <div className="mb-1 flex items-center justify-between">
          <button
            onClick={() => setMiniCursor((d) => subMonths(d, 1))}
            className={`flex h-7 w-7 items-center justify-center rounded-full ${navBtnCls}`}
            aria-label={t("calendar.prevMonth") || "‹"}
          >
            ‹
          </button>
          <span className={`text-xs font-medium capitalize ${textCls}`}>
            {miniCursor.toLocaleString(uiLocale, { month: "long", year: "numeric" })}
          </span>
          <button
            onClick={() => setMiniCursor((d) => addMonths(d, 1))}
            className={`flex h-7 w-7 items-center justify-center rounded-full ${navBtnCls}`}
            aria-label={t("calendar.nextMonth") || "›"}
          >
            ›
          </button>
        </div>

        {/* Day name headers */}
        <div className="grid grid-cols-7 text-center">
          {DAY_KEYS.map((k) => (
            <div key={k} className={`py-0.5 text-[10px] font-medium ${mutedCls}`}>
              {t(`weekday.${k}`)}
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
                    ? weekSelCls
                    : isCurrentMonth
                    ? `${textCls} ${hoverCls}`
                    : `${inactiveCls} ${hoverCls}`,
                ].join(" ")}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`mx-3 my-3 border-t ${borderCls}`} />
      </>
      )}

      {/* Staff list */}
      <div className="px-3">
        <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${mutedCls}`}>
          {t("reception.mastersTitle")}
        </p>
        <div className="space-y-0.5">
          {staff.map((member) => {
            const c = googleStaffColor(member, staffHueMap);
            const checked = visibleStaffIds.has(member.id);
            return (
              <label
                key={member.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 ${hoverCls}`}
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
                <span className={`truncate text-sm ${textCls}`}>{member.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Language switcher */}
      <div className={`mt-auto border-t px-3 pt-3 ${borderCls}`}>
        <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${mutedCls}`}>
          {t("common.language")}
        </p>
        <div className="flex gap-1">
          {(["ru", "et"] as const).map((code) => (
            <button
              key={code}
              onClick={() => void i18n.changeLanguage(code)}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                currentLang === code
                  ? "bg-[#e8f0fe] text-[#1a73e8]"
                  : `${mutedCls} ${hoverCls}`,
              ].join(" ")}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
