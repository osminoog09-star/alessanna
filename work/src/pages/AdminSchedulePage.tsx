import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { supabase } from "../lib/supabase";
import { isStaffRowAdmin, normalizeStaffMember } from "../lib/roles";
import type { StaffMember, StaffWorkDateRow } from "../types/database";
import { AdminDaySchedulePopup } from "../components/reception/AdminDaySchedulePopup";
import { googleStaffColor } from "../components/reception/receptionColors";
import { buildStaffHueMap } from "../lib/staffHue";

const RU_WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MON_FIRST_DOW = [1, 2, 3, 4, 5, 6, 0] as const;

export function AdminSchedulePage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [workDates, setWorkDates] = useState<StaffWorkDateRow[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [dayPopup, setDayPopup] = useState<{ day: Date; x: number; y: number } | null>(null);

  const hueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  const load = useCallback(async () => {
    const monthStart = format(startOfMonth(viewMonth), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(viewMonth), "yyyy-MM-dd");
    const [staffRes, workRes] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase
        .from("staff_work_dates")
        .select("*")
        .gte("work_date", monthStart)
        .lte("work_date", monthEnd),
    ]);
    if (staffRes.data) {
      setStaff(
        (staffRes.data as Record<string, unknown>[])
          .filter((r) => !isStaffRowAdmin(r))
          .map((r) => normalizeStaffMember(r as StaffMember)),
      );
    }
    setWorkDates((workRes.data ?? []) as StaffWorkDateRow[]);
    setLoading(false);
  }, [viewMonth]);

  useEffect(() => { void load(); }, [load]);

  const calendarDays = useMemo(() => {
    const from = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [viewMonth]);

  const today = useMemo(() => new Date(), []);

  const monthLabel = viewMonth.toLocaleString("ru-RU", { month: "long", year: "numeric" });

  function staffForDay(day: Date): StaffMember[] {
    const dateStr = format(day, "yyyy-MM-dd");
    const ids = new Set(workDates.filter((r) => r.work_date === dateStr).map((r) => r.staff_id));
    return staff.filter((m) => ids.has(m.id));
  }

  if (loading) {
    return <p className="text-zinc-500">Загрузка…</p>;
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">График</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Нажмите на день чтобы назначить мастеров на эту дату.
        </p>
      </header>

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setViewMonth((m) => subMonths(m, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          ←
        </button>
        <span className="min-w-[160px] text-center text-base font-medium capitalize text-white">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => setViewMonth(startOfMonth(new Date()))}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Сегодня
        </button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900">
          {MON_FIRST_DOW.map((dow, i) => (
            <div
              key={dow}
              className={[
                "py-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500",
                i < 6 ? "border-r border-zinc-800" : "",
              ].join(" ")}
            >
              {RU_WEEK[i]}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const inMonth = isSameMonth(day, viewMonth);
            const isToday = isSameDay(day, today);
            const working = staffForDay(day);
            const colPos = idx % 7;

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={(e) => setDayPopup({ day, x: e.clientX, y: e.clientY })}
                className={[
                  "group relative flex min-h-[90px] flex-col gap-1 p-2 text-left transition hover:bg-zinc-800/60",
                  colPos < 6 ? "border-r border-zinc-800" : "",
                  idx < calendarDays.length - 7 ? "border-b border-zinc-800" : "",
                  inMonth ? "" : "opacity-35",
                ].join(" ")}
              >
                {/* Date number */}
                <span
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                    isToday
                      ? "bg-[#1a73e8] text-white"
                      : "text-zinc-300 group-hover:bg-zinc-700",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </span>

                {/* Staff badges */}
                <div className="flex flex-col gap-0.5">
                  {working.map((m) => {
                    const c = googleStaffColor(m, hueMap);
                    return (
                      <span
                        key={m.id}
                        className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight"
                        style={{ backgroundColor: c.bg, color: c.fg }}
                      >
                        {m.name.split(" ")[0]}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {dayPopup && (
        <AdminDaySchedulePopup
          day={dayPopup.day}
          anchorX={dayPopup.x}
          anchorY={dayPopup.y}
          allStaff={staff}
          workDates={workDates}
          onClose={() => setDayPopup(null)}
          onSaved={() => { void load(); }}
        />
      )}
    </div>
  );
}
