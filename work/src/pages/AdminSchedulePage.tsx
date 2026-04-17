import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { ToggleSwitch } from "../components/ToggleSwitch";
import type { StaffScheduleRow, StaffTableRow } from "../types/database";

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Выбор в списке: применить график ко всем активным сотрудникам */
const ALL_STAFF_VALUE = "__all_staff__";

type DayRow = { day_of_week: number; start: string; end: string; working: boolean };

function emptyWeek(): DayRow[] {
  return DAYS.map((d) => ({ day_of_week: d, start: "09:00", end: "17:00", working: true }));
}

export function AdminSchedulePage() {
  const { t } = useTranslation();
  const [staffList, setStaffList] = useState<StaffTableRow[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const [rows, setRows] = useState<DayRow[]>(emptyWeek);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    const { data, error } = await supabase.from("staff").select("*").eq("is_active", true).order("name");
    if (error) {
      setErr(error.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as StaffTableRow[];
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
      })
    );
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    if (staffId && staffId !== ALL_STAFF_VALUE) void loadSchedule(staffId);
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

    await supabase.from("staff_schedule").delete().eq("staff_id", staffId);
    const inserts = buildInsertsForStaff(staffId);
    const { error } = await supabase.from("staff_schedule").insert(inserts);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    void loadSchedule(staffId);
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-xl space-y-6 text-zinc-200">
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
          className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
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
      <p className="text-xs text-zinc-500">
        Снимите галочку «работает в этот день», чтобы пометить выходной: строка в графике не сохраняется, в календаре в
        этот день слоты не строятся.
      </p>
      <form onSubmit={onSave} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        {rows.map((r) => {
          const k = String(r.day_of_week) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
          return (
            <div key={r.day_of_week} className="flex flex-wrap items-center gap-3 text-sm">
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
              {!r.working && <span className="text-xs text-zinc-600">выходной</span>}
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
  );
}
