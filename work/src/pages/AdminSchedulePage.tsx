import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
} from "date-fns";
import { supabase } from "../lib/supabase";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { isStaffRowAdmin } from "../lib/roles";
import type { StaffScheduleRow, StaffTableRow } from "../types/database";

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEK_HEADER_DOW = [1, 2, 3, 4, 5, 6, 0] as const;

/** Выбор в списке: применить график ко всем активным сотрудникам */
const ALL_STAFF_VALUE = "__all_staff__";

type DayRow = { day_of_week: number; start: string; end: string; working: boolean };

function emptyWeek(): DayRow[] {
  return DAYS.map((d) => ({ day_of_week: d, start: "09:00", end: "17:00", working: true }));
}

function rowForWeekday(rows: DayRow[], dow: number): DayRow | undefined {
  return rows.find((r) => r.day_of_week === dow);
}

export function AdminSchedulePage() {
  const { t } = useTranslation();
  const [staffList, setStaffList] = useState<StaffTableRow[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const [rows, setRows] = useState<DayRow[]>(emptyWeek);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [focusedDow, setFocusedDow] = useState<number | null>(null);

  const loadStaff = useCallback(async () => {
    const { data, error } = await supabase.from("staff").select("*").eq("is_active", true).order("name");
    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    const list = ((data ?? []) as StaffTableRow[]).filter((row) => !isStaffRowAdmin(row));
    setStaffList(list);
    setStaffId((prev) => {
      if (list.length === 0) return "";
      if (prev === ALL_STAFF_VALUE) return ALL_STAFF_VALUE;
      if (prev && list.some((s) => s.id === prev)) return prev;
      return list[0]!.id;
    });
    setLoading(false);
  }, []);

  const loadSchedule = useCallback(async (sid: string) => {
    if (!sid) return;
    const { data, error } = await supabase.from("staff_schedule").select("*").eq("staff_id", sid);
    if (error) {
      setErr(error.message);
      return;
    }
    const list = (data ?? []) as StaffScheduleRow[];
    const map = new Map(list.map((r) => [r.day_of_week, r]));
    const hasAnySaved = list.length > 0;
    setRows(
      DAYS.map((d) => {
        const ex = map.get(d);
        if (ex) {
          return {
            day_of_week: d,
            start: ex.start_time.slice(0, 5),
            end: ex.end_time.slice(0, 5),
            working: true,
          };
        }
        return {
          day_of_week: d,
          start: "09:00",
          end: "17:00",
          working: !hasAnySaved,
        };
      }),
    );
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    setFocusedDow(null);
    if (staffId === ALL_STAFF_VALUE) {
      setRows(emptyWeek());
      return;
    }
    if (staffId) void loadSchedule(staffId);
  }, [staffId, loadSchedule]);

  function setDayField(day: number, field: "start" | "end", value: string) {
    setRows((prev) => prev.map((r) => (r.day_of_week === day ? { ...r, [field]: value } : r)));
  }

  function setDayWorking(day: number, working: boolean) {
    setRows((prev) => prev.map((r) => (r.day_of_week === day ? { ...r, working } : r)));
  }

  function buildInsertsForStaff(targetStaffId: string) {
    return rows
      .filter((r) => r.working)
      .map((r) => ({
        staff_id: targetStaffId,
        day_of_week: r.day_of_week,
        start_time: r.start.length === 5 ? `${r.start}:00` : r.start,
        end_time: r.end.length === 5 ? `${r.end}:00` : r.end,
      }));
  }

  const calendarDays = useMemo(() => {
    const from = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [viewMonth]);

  const today = useMemo(() => new Date(), []);

  function focusWeekdayFromDate(d: Date) {
    const dow = d.getDay();
    setFocusedDow(dow);
    window.requestAnimationFrame(() => {
      document.getElementById(`schedule-day-${dow}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function onCalendarDayClick(d: Date) {
    focusWeekdayFromDate(d);
  }

  function onCalendarDayDoubleClick(d: Date) {
    const dow = d.getDay();
    const row = rowForWeekday(rows, dow);
    if (!row) return;
    setDayWorking(dow, !row.working);
    setFocusedDow(dow);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!staffId) return;
    setSaving(true);
    setErr(null);

    if (staffId === ALL_STAFF_VALUE) {
      if (staffList.length === 0) {
        setSaving(false);
        return;
      }
      if (!window.confirm(t("adminSchedule.saveAllConfirm"))) {
        setSaving(false);
        return;
      }
      const ids = staffList.map((s) => s.id);
      const { error: delErr } = await supabase.from("staff_schedule").delete().in("staff_id", ids);
      if (delErr) {
        setErr(delErr.message);
        setSaving(false);
        return;
      }
      const inserts = ids.flatMap((id) => buildInsertsForStaff(id));
      if (inserts.length > 0) {
        const { error: insErr } = await supabase.from("staff_schedule").insert(inserts);
        if (insErr) {
          setErr(insErr.message);
          setSaving(false);
          return;
        }
      }
      setSaving(false);
      return;
    }

    const bad = rows.find((r) => r.working && r.start >= r.end);
    if (bad) {
      setSaving(false);
      setErr(t("adminSchedule.invalidInterval"));
      return;
    }

    const { error: delErr } = await supabase.from("staff_schedule").delete().eq("staff_id", staffId);
    if (delErr) {
      setErr(delErr.message);
      setSaving(false);
      return;
    }
    const inserts = buildInsertsForStaff(staffId);
    if (inserts.length > 0) {
      const { error } = await supabase.from("staff_schedule").insert(inserts);
      if (error) {
        setSaving(false);
        setErr(error.message);
        return;
      }
    }
    setSaving(false);
    void loadSchedule(staffId);
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-5xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">{t("nav.adminSchedule")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("adminSchedule.subtitle")}</p>
      </header>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <label className="block text-sm text-zinc-400">
        {t("calendar.staff")}
        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="mt-1 block w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
        >
          {staffList.length > 0 ? <option value={ALL_STAFF_VALUE}>{t("adminSchedule.allStaff")}</option> : null}
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {staffId === ALL_STAFF_VALUE && (
        <p className="text-xs text-amber-200/90">{t("adminSchedule.allStaffHint")}</p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] lg:items-start">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">{t("adminSchedule.calendarTitle")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, -1))}
                className="rounded-lg border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
                aria-label={t("adminSchedule.prevMonth")}
              >
                ←
              </button>
              <span className="min-w-[10rem] text-center text-sm font-medium text-zinc-100">
                {format(viewMonth, "LLLL yyyy")}
              </span>
              <button
                type="button"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
                className="rounded-lg border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
                aria-label={t("adminSchedule.nextMonth")}
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setViewMonth(startOfMonth(new Date()))}
                className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-950/60"
              >
                {t("adminSchedule.today")}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{t("adminSchedule.calendarHint")}</p>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {WEEK_HEADER_DOW.map((d) => (
              <div key={d} className="py-1">
                {t(`weekday.${d}`)}
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {calendarDays.map((d) => {
              const inMonth = isSameMonth(d, viewMonth);
              const dow = d.getDay();
              const row = rowForWeekday(rows, dow);
              const working = row?.working ?? false;
              const isToday = isSameDay(d, today);
              const isFocused = focusedDow === dow;
              const focusRing = isFocused
                ? "ring-2 ring-amber-400/80 ring-offset-2 ring-offset-zinc-950"
                : isToday
                  ? "ring-2 ring-sky-500/70 ring-offset-2 ring-offset-zinc-950"
                  : "";
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  onClick={() => onCalendarDayClick(d)}
                  onDoubleClick={() => onCalendarDayDoubleClick(d)}
                  className={[
                    "flex min-h-[4.5rem] flex-col items-center justify-center rounded-xl border-2 px-1 py-2 text-center transition",
                    inMonth ? "opacity-100" : "opacity-35",
                    working
                      ? "border-emerald-800/50 bg-emerald-950/25 text-emerald-50 hover:border-emerald-600/60"
                      : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:border-zinc-600",
                    focusRing,
                  ].join(" ")}
                >
                  <span className="text-base font-bold tabular-nums">{format(d, "d")}</span>
                  <span className="mt-0.5 line-clamp-2 text-[10px] font-medium leading-tight text-zinc-400">
                    {working && row ? `${row.start}–${row.end}` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-3">
          <p className="text-xs text-zinc-500">{t("adminSchedule.weekTemplateHint")}</p>
          <form onSubmit={onSave} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            {rows.map((r) => {
              const k = String(r.day_of_week) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
              const isFocused = focusedDow === r.day_of_week;
              return (
                <div
                  id={`schedule-day-${r.day_of_week}`}
                  key={r.day_of_week}
                  className={[
                    "flex flex-wrap items-center gap-3 rounded-lg p-2 text-sm transition",
                    isFocused ? "bg-sky-950/35 ring-1 ring-sky-500/40" : "",
                  ].join(" ")}
                >
                  <div className="flex w-48 shrink-0 items-center gap-2 text-zinc-300">
                    <ToggleSwitch
                      size="sm"
                      checked={r.working}
                      onCheckedChange={(v) => setDayWorking(r.day_of_week, v)}
                      aria-label={`${t(`weekday.${k}`)}: рабочий день`}
                    />
                    <span className="w-24 text-zinc-400">{t(`weekday.${k}`)}</span>
                  </div>
                  <input
                    type="time"
                    value={r.start}
                    disabled={!r.working}
                    onChange={(e) => setDayField(r.day_of_week, "start", e.target.value)}
                    className="rounded border border-zinc-700 bg-black px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <span className="text-zinc-600">–</span>
                  <input
                    type="time"
                    value={r.end}
                    disabled={!r.working}
                    onChange={(e) => setDayField(r.day_of_week, "end", e.target.value)}
                    className="rounded border border-zinc-700 bg-black px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  {!r.working && <span className="text-xs text-zinc-600">{t("calendar.dayOff")}</span>}
                </div>
              );
            })}
            <button
              type="submit"
              disabled={saving || !staffId || (staffId === ALL_STAFF_VALUE && staffList.length === 0)}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {staffId === ALL_STAFF_VALUE ? t("adminSchedule.saveForAll") : t("common.save")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
