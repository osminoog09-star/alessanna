import { FormEvent, useEffect, useMemo, useState } from "react";
import { endOfDay, format, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember } from "../types/database";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  staffList: StaffMember[];
  initialDay: Date;
};

export function CloseDayModal({ open, onClose, onSaved, staffList, initialDay }: Props) {
  const { t } = useTranslation();
  const [dayStr, setDayStr] = useState(() => format(initialDay, "yyyy-MM-dd"));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const activeStaff = useMemo(() => staffList.filter((e) => e.active), [staffList]);

  useEffect(() => {
    if (!open) return;
    setDayStr(format(initialDay, "yyyy-MM-dd"));
    setSelectedIds(new Set(staffList.filter((e) => e.active).map((e) => e.id)));
    setError("");
  }, [open, initialDay, staffList]);

  if (!open) return null;

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(activeStaff.map((e) => e.id)));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const day = new Date(dayStr + "T12:00:00");
    if (Number.isNaN(day.getTime())) {
      setError(t("closeDay.invalidDate"));
      return;
    }
    const targets = [...selectedIds];
    if (!targets.length) {
      setError(t("closeDay.pickStaff"));
      return;
    }
    const start = startOfDay(day);
    const end = endOfDay(day);
    setSaving(true);
    const rows = targets.map((staff_id) => ({
      staff_id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      reason: t("closeDay.blockReason"),
      time_off_type: "manual_block" as const,
    }));
    const { error: insErr } = await supabase.from("staff_time_off").insert(rows);
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">{t("closeDay.title")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("closeDay.subtitle")}</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-500">{t("closeDay.date")}</label>
            <input
              type="date"
              value={dayStr}
              onChange={(e) => setDayStr(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={selectAll} className="text-xs text-sky-400 hover:underline">
                {t("closeDay.all")}
              </button>
              <button type="button" onClick={selectNone} className="text-xs text-zinc-500 hover:underline">
                {t("closeDay.none")}
              </button>
            </div>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-2">
              {activeStaff.map((em) => (
                <li key={em.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(em.id)}
                      onChange={() => toggleId(em.id)}
                    />
                    {em.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {t("closeDay.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
