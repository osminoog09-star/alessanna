import { FormEvent, useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { isStaffRowAdmin } from "../lib/roles";
import type { StaffTimeOffRow, StaffTableRow } from "../types/database";

export function AdminTimeOffPage() {
  const { t } = useTranslation();
  const [staffList, setStaffList] = useState<StaffTableRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [blocks, setBlocks] = useState<StaffTimeOffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase.from("staff").select("*").eq("is_active", true).order("name");
    /* Тех-поддержка сайта (admin) не работает с клиентами и не берёт отгулы. */
    const list = ((data ?? []) as StaffTableRow[]).filter((row) => !isStaffRowAdmin(row));
    setStaffList(list);
    setStaffId((prev) => prev || (list[0]?.id ?? ""));
    setLoading(false);
  }, []);

  const loadBlocks = useCallback(async () => {
    const { data, error } = await supabase
      .from("staff_time_off")
      .select("*")
      .order("start_time", { ascending: false })
      .limit(200);
    if (error) setErr(error.message);
    else setBlocks((data ?? []) as StaffTimeOffRow[]);
  }, []);

  useEffect(() => {
    void loadStaff();
    void loadBlocks();
  }, [loadStaff, loadBlocks]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!staffId || !start || !end) return;
    const { error } = await supabase.from("staff_time_off").insert({
      staff_id: staffId,
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      reason: reason.trim() || null,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setReason("");
    void loadBlocks();
  }

  async function remove(id: string) {
    if (!window.confirm(t("adminTimeOff.deleteConfirm"))) return;
    await supabase.from("staff_time_off").delete().eq("id", id);
    void loadBlocks();
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-2xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">{t("nav.adminTimeOff")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("adminTimeOff.subtitle")}</p>
      </header>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <form onSubmit={onAdd} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <label className="block text-sm text-zinc-400">
          {t("calendar.staff")}
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
          >
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-zinc-400">
          {t("adminTimeOff.start")}
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
          />
        </label>
        <label className="block text-sm text-zinc-400">
          {t("adminTimeOff.end")}
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
          />
        </label>
        <label className="block text-sm text-zinc-400">
          {t("adminTimeOff.reason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
          />
        </label>
        <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white">
          {t("common.add")}
        </button>
      </form>

      <ul className="space-y-2">
        {blocks.map((b) => {
          const st = staffList.find((s) => s.id === b.staff_id);
          return (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-white">{st?.name ?? b.staff_id}</span>
                <span className="text-zinc-500">
                  {" "}
                  {format(parseISO(b.start_time), "Pp")} – {format(parseISO(b.end_time), "Pp")}
                </span>
                {b.reason && <p className="text-xs text-zinc-500">{b.reason}</p>}
              </div>
              <button type="button" className="text-red-400 underline" onClick={() => void remove(b.id)}>
                {t("adminTimeOff.delete")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
