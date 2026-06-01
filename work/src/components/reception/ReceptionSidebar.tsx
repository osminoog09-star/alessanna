import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
import { useTheme, type ThemeId } from "../../context/ThemeContext";

const SWATCHES: Record<ThemeId, [string, string, string]> = {
  white:     ["#ffffff", "#f1f3f4", "#1a73e8"],
  champagne: ["#fbfaf6", "#f4f1eb", "#a3855e"],
  stone:     ["#25221e", "#38332d", "#d4b896"],
  onyx:      ["#0a0a0a", "#1a1a1a", "#c4a574"],
};
const RECEPTION_THEME_IDS: ThemeId[] = ["white", "champagne", "stone", "onyx"];

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
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const currentLang = i18n.language.split("-")[0] ?? "ru";
  const uiLocale = currentLang === "et" ? "et-EE" : "ru-RU";
  const [miniCursor, setMiniCursor] = useState(() => new Date());
  const [crmPrompt, setCrmPrompt] = useState(false);
  const [pwValue, setPwValue] = useState("");
  const [pwError, setPwError] = useState(false);
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

      {/* Bottom section: language + theme + CRM */}
      <div className={`mt-auto border-t px-3 pt-3 pb-3 ${borderCls}`}>
        {/* Language switcher */}
        <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${mutedCls}`}>
          {t("common.language")}
        </p>
        <div className="mb-3 flex gap-1">
          {(["ru", "et"] as const).map((code) => (
            <button
              key={code}
              onClick={() => void i18n.changeLanguage(code)}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                currentLang === code ? accentSel : `${mutedCls} ${hoverCls}`,
              ].join(" ")}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Theme picker */}
        <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${mutedCls}`}>
          {t("nav.themeLabel")}
        </p>
        <div className="mb-3 flex gap-2">
          {RECEPTION_THEME_IDS.map((id) => {
            const active = theme === id;
            const sw = SWATCHES[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={active}
                title={t(`nav.theme.${id}`)}
                className="relative flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{
                  background: `linear-gradient(135deg, ${sw[0]} 0%, ${sw[1]} 60%, ${sw[2]} 100%)`,
                  boxShadow: active
                    ? `0 0 0 2px ${sw[0]}, 0 0 0 3.5px rgb(var(--c-gold))`
                    : "0 0 0 1px rgba(128,128,128,0.25)",
                }}
              />
            );
          })}
        </div>

        {/* CRM button */}
        <button
          onClick={() => { setCrmPrompt(true); setPwValue(""); setPwError(false); }}
          className={[
            "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
            dark ? "text-muted hover:bg-white/5 hover:text-gold" : `text-muted ${hoverCls}`,
          ].join(" ")}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="currentColor">
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
          {t("reception.toCrm")}
        </button>
      </div>

      {/* CRM password modal */}
      {crmPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-panel shadow-2xl ring-1 ring-line/15">
            <div className={`px-5 py-4 ${useGold ? "bg-gold/10 border-b border-gold/20" : "bg-[#1a73e8]/10 border-b border-[#1a73e8]/20"}`}>
              <p className={`text-sm font-semibold ${useGold ? "text-gold" : "text-[#1a73e8]"}`}>
                {t("reception.crmPasswordTitle")}
              </p>
            </div>
            <form
              className="p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (pwValue === "2025alessanna") { navigate("/"); }
                else { setPwError(true); setPwValue(""); }
              }}
            >
              <input
                type="password"
                autoFocus
                value={pwValue}
                onChange={(e) => { setPwValue(e.target.value); setPwError(false); }}
                placeholder={t("reception.crmPasswordPlaceholder")}
                className={[
                  "w-full rounded-lg border bg-canvas px-3 py-2.5 text-sm text-fg outline-none transition",
                  pwError
                    ? "border-red-400 focus:border-red-400 focus:ring-1 focus:ring-red-400"
                    : useGold
                    ? "border-line/20 focus:border-gold focus:ring-1 focus:ring-gold/40"
                    : "border-line/20 focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]/40",
                ].join(" ")}
              />
              {pwError && <p className="mt-1.5 text-xs text-red-400">{t("reception.crmPasswordError")}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCrmPrompt(false)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-muted transition-colors ${hoverCls}`}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className={[
                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                    useGold ? "bg-gold text-canvas hover:bg-gold/90" : "bg-[#1a73e8] text-white hover:bg-[#1557b0]",
                  ].join(" ")}
                >
                  {t("common.confirm")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
