import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffTimeOffRow } from "../types/database";
import { appointmentInterval, intervalsOverlap } from "../lib/slots";

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalDatetimeValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialStart: Date;
  initialStaffId: string;
  staffList: StaffMember[];
  lockStaff?: boolean;
  /** Active service lines (non-cancelled visits) for overlap checks. */
  busyLines: Array<{ staff_id: string; start_time: string; end_time: string }>;
  timeOffRows: StaffTimeOffRow[];
};

export function BlockTimeModal({
  open,
  onClose,
  onSaved,
  initialStart,
  initialStaffId,
  staffList,
  lockStaff = false,
  busyLines,
  timeOffRows,
}: Props) {
  const { t } = useTranslation();
  const [staffId, setStaffId] = useState(initialStaffId);
  const [startStr, setStartStr] = useState(() => toLocalDatetimeValue(initialStart));
  const [endStr, setEndStr] = useState(() =>
    toLocalDatetimeValue(new Date(initialStart.getTime() + 60 * 60 * 1000))
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const activeStaff = useMemo(() => staffList.filter((e) => e.active), [staffList]);

  useEffect(() => {
    if (!open) return;
    setStaffId(initialStaffId);
    setStartStr(toLocalDatetimeValue(initialStart));
    setEndStr(toLocalDatetimeValue(new Date(initialStart.getTime() + 60 * 60 * 1000)));
    setReason("");
    setError("");
  }, [open, initialStart, initialStaffId]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const start = parseLocalDatetimeValue(startStr);
    const end = parseLocalDatetimeValue(endStr);
    if (!start || !end) {
      setError(t("blockTimeModal.invalidRange"));
      return;
    }
    if (end <= start) {
      setError(t("blockTimeModal.invalidRange"));
      return;
    }

    for (const b of busyLines) {
      if (b.staff_id !== staffId) continue;
      const iv = appointmentInterval(b);
      if (!iv) continue;
      if (intervalsOverlap(start, end, iv.start, iv.end)) {
        setError(t("blockTimeModal.overlapAppointment"));
        return;
      }
    }

    for (const off of timeOffRows) {
      if (off.staff_id !== staffId) continue;
      const iv = appointmentInterval({ start_time: off.start_time, end_time: off.end_time });
      if (!iv) continue;
      if (intervalsOverlap(start, end, iv.start, iv.end)) {
        setError(t("blockTimeModal.overlapTimeOff"));
        return;
      }
    }

    setSaving(true);
    const { error: insErr } = await supabase.from("staff_time_off").insert({
      staff_id: staffId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      reason: reason.trim() || null,
    });
    setSaving(false);
    if (insErr) {
      setError(t("auth.error.rpcFailed", { message: insErr.message }));
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-red-900/40 bg-zinc-950/95 p-6 shadow-2xl backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-white">{t("blockTimeModal.title")}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {!lockStaff && (
            <div>
              <label className="text-xs text-zinc-500">{t("modal.staff")}</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                {activeStaff.map((em) => (
                  <option key={em.id} value={em.id}>
                    {em.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-500">{t("blockTimeModal.start")}</label>
            <input
              type="datetime-local"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">{t("blockTimeModal.end")}</label>
            <input
              type="datetime-local"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500">{t("blockTimeModal.reason")}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              placeholder="—"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
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
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
