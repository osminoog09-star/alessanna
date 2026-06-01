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
import { useTheme } from "../../context/ThemeContext";

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

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0] as const;

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
  const { theme } = useTheme();
  const currentLang = i18n.language.split("-")[0] ?? "ru";
  const uiLocale = currentLang === "et" ? "et-EE" : "ru-RU";
  const [miniCursor, setMiniCursor] = useState(() => new Date());
  const today = new Date();
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  const borderCls = "border-line/15";
  const mutedCls = "text-muted";
  const textCls = "text-fg";
  const hoverCls = dark ? "hover:bg-white/5" : "hover:bg-surface";
  const navBtnCls = dark ? "text-muted hover:bg-white/5 hover:text-gold" : "text-muted hover:bg-surface";

  // Gold accents for all brand themes; blue only for plain white
  const useGold = theme !== "white";
  const todayBubble = useGold ? "bg-gold font-bold text-canvas" : "bg-[#1a73e8] font-bold text-white";
  const accentSel = useGold ? "bg-gold/15 text-gold" : "bg-[#e8f0fe] text-[#1a73e8]";

  const monthStart = startOfMonth(miniCursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const miniDays = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  return (
    <div className={`flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r py-3 bg-canvas ${borderCls}`}>
      {/* Logo */}
      <div className="mb-2 px-5 pt-1">
        <img
          src={dark ? "/alessanna-logo.png" : "/alessanna-logo-light.png"}
          alt="AlesSanna"
          className="w-full object-contain"
          style={{ maxHeight: 72 }}
          draggable={false}
        />
      </div>

      {/* View switcher — mobile only */}
      {onViewChange && view && (
        <div className={`mb-3 mx-3 flex items-center rounded-lg border p-0.5 md:hidden ${borderCls}`}>
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={[
                "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                view === v ? accentSel : `${mutedCls} ${hoverCls}`,
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
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${navBtnCls}`}
                aria-label={t("calendar.prevMonth") || "‹"}
              >
                ‹
              </button>
              <span className={`text-xs font-medium capitalize ${textCls}`}>
                {miniCursor.toLocaleString(uiLocale, { month: "long", year: "numeric" })}
              </span>
              <button
                onClick={() => setMiniCursor((d) => addMonths(d, 1))}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${navBtnCls}`}
                aria-label={t("calendar.nextMonth") || "›"}
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 text-center">
              {DAY_KEYS.map((k) => (
                <div key={k} className={`py-0.5 text-[10px] font-medium ${mutedCls}`}>
                  {t(`weekday.${k}`)}
                </div>
              ))}
            </div>

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
                        ? todayBubble
                        : isSelected && !isToday
                        ? accentSel
                        : isCurrentMonth
                        ? `${textCls} ${hoverCls}`
                        : `text-fg/30 ${hoverCls}`,
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
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${hoverCls}`}
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

    </div>
  );
}
