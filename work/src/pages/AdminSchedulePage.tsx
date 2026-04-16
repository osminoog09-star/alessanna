import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffScheduleRow, StaffTableRow } from "../types/database";

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

type DayRow = { day_of_week: number; start: string; end: string };

function emptyWeek(): DayRow[] {
  return DAYS.map((d) => ({ day_of_week: d, start: "09:00", end: "17:00" }));
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
    setStaffList((data ?? []) as StaffTableRow[]);
    setStaffId((prev) => prev || ((data?.[0] as StaffTableRow | undefined)?.id ?? ""));
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
    setRows(
      DAYS.map((d) => {
        const ex = map.get(d);
        return {
          day_of_week: d,
          start: ex ? ex.start_time.slice(0, 5) : "09:00",
          end: ex ? ex.end_time.slice(0, 5) : "17:00",
        };
      })
    );
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    if (staffId) void loadSchedule(staffId);
  }, [staffId, loadSchedule]);

  function setDayField(day: number, field: "start" | "end", value: string) {
    setRows((prev) => prev.map((r) => (r.day_of_week === day ? { ...r, [field]: value } : r)));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!staffId) return;
    setSaving(true);
    setErr(null);
    await supabase.from("staff_schedule").delete().eq("staff_id", staffId);
    const inserts = rows.map((r) => ({
      staff_id: staffId,
      day_of_week: r.day_of_week,
      start_time: r.start.length === 5 ? `${r.start}:00` : r.start,
      end_time: r.end.length === 5 ? `${r.end}:00` : r.end,
    }));
    const { error } = await supabase.from("staff_schedule").insert(inserts);
    setSaving(false);
    if (error) setErr(error.message);
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
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <form onSubmit={onSave} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        {rows.map((r) => {
          const k = String(r.day_of_week) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
          return (
            <div key={r.day_of_week} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-24 text-zinc-400">{t(`weekday.${k}`)}</span>
              <input
                type="time"
                value={r.start}
                onChange={(e) => setDayField(r.day_of_week, "start", e.target.value)}
                className="rounded border border-zinc-700 bg-black px-2 py-1"
              />
              <span className="text-zinc-600">–</span>
              <input
                type="time"
                value={r.end}
                onChange={(e) => setDayField(r.day_of_week, "end", e.target.value)}
                className="rounded border border-zinc-700 bg-black px-2 py-1"
              />
            </div>
          );
        })}
        <button
          type="submit"
          disabled={saving || !staffId}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t("common.save")}
        </button>
      </form>
    </div>
  );
}
