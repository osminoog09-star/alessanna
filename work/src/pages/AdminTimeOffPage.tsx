import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { isStaffRowAdmin } from "../lib/roles";
import type { StaffTimeOffRow, StaffTableRow } from "../types/database";

/** Format Date → строка для <input type="datetime-local"> (YYYY-MM-DDTHH:mm). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Открыть native datetime picker — единая точка с фолбэком на focus(). */
function openPicker(input: HTMLInputElement | null) {
  if (!input) return;
  type WithShowPicker = HTMLInputElement & { showPicker?: () => void };
  const el = input as WithShowPicker;
  if (typeof el.showPicker === "function") {
    try { el.showPicker(); return; } catch { /* fallthrough to focus */ }
  }
  input.focus();
}

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

  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

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

  /** Изменение «Начала» — если конец ещё пустой, авто-предлагаем «+1 час».
   * Это самый частый паттерн (одна процедура, перерыв на обед и т.п.). */
  function onChangeStart(value: string) {
    setStart(value);
    if (!end && value) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(d.getHours() + 1);
        setEnd(toLocalInput(d));
      }
    }
  }

  /** «Сейчас» = начало через 5 минут (округлено), конец = +1 час. */
  function presetNow() {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    setStart(toLocalInput(now));
    setEnd(toLocalInput(later));
  }

  /** «Весь день» = текущая (или уже выбранная в start) дата с 00:00 до 23:59. */
  function presetWholeDay() {
    const baseStr = start || end || toLocalInput(new Date());
    const base = new Date(baseStr);
    if (Number.isNaN(base.getTime())) return;
    const dayStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 0, 0);
    setStart(toLocalInput(dayStart));
    setEnd(toLocalInput(dayEnd));
  }

  /** «Завтра, рабочий день» = завтра 09:00 → 18:00. */
  function presetTomorrowWorkday() {
    const t0 = new Date();
    t0.setDate(t0.getDate() + 1);
    const a = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), 9, 0, 0, 0);
    const b = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate(), 18, 0, 0, 0);
    setStart(toLocalInput(a));
    setEnd(toLocalInput(b));
  }

  /** Длительность блока в человекочитаемом виде («2 ч 30 мин», «—»). */
  function durationLabel(): string | null {
    if (!start || !end) return null;
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null;
    const mins = Math.round((b - a) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} мин`;
    if (m === 0) return `${h} ч`;
    return `${h} ч ${m} мин`;
  }
  const dur = durationLabel();

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div className="max-w-2xl space-y-6 text-fg">
      <header>
        <h1 className="text-xl font-semibold text-fg">{t("nav.adminTimeOff")}</h1>
        <p className="mt-1 text-sm text-muted">{t("adminTimeOff.subtitle")}</p>
      </header>
      {err && <p className="text-sm text-red-400">{err}</p>}

      <form onSubmit={onAdd} className="space-y-4 rounded-xl border border-line/15 bg-panel p-4">
        <label className="block text-sm text-muted">
          {t("calendar.staff")}
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line/20 bg-black px-3 py-2 text-fg"
          >
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Quick presets — закрывают 80% повседневных кейсов одним кликом. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted">Быстро:</span>
          <button
            type="button"
            onClick={presetNow}
            className="inline-flex items-center gap-1 rounded-full border border-line/20 bg-canvas/40 px-2.5 py-1 text-xs text-fg transition hover:border-sky-500/60 hover:bg-sky-950/30 hover:text-sky-100"
            title="Сейчас → +1 час"
          >
            Сейчас на 1 час
          </button>
          <button
            type="button"
            onClick={presetWholeDay}
            className="inline-flex items-center gap-1 rounded-full border border-line/20 bg-canvas/40 px-2.5 py-1 text-xs text-fg transition hover:border-sky-500/60 hover:bg-sky-950/30 hover:text-sky-100"
            title="Весь день (00:00 – 23:59) от выбранной/сегодняшней даты"
          >
            Весь день
          </button>
          <button
            type="button"
            onClick={presetTomorrowWorkday}
            className="inline-flex items-center gap-1 rounded-full border border-line/20 bg-canvas/40 px-2.5 py-1 text-xs text-fg transition hover:border-sky-500/60 hover:bg-sky-950/30 hover:text-sky-100"
            title="Завтра, 09:00 – 18:00"
          >
            Завтра, 9–18
          </button>
          {(start || end) && (
            <button
              type="button"
              onClick={() => { setStart(""); setEnd(""); }}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-[11px] text-muted transition hover:border-line/20 hover:text-fg"
              title="Очистить даты"
            >
              очистить
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-muted">
            {t("adminTimeOff.start")}
            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => openPicker(startRef.current)}
                className="absolute left-2 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-surface hover:text-sky-300"
                tabIndex={-1}
                aria-label="Открыть календарь"
                title="Открыть календарь"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </button>
              <input
                ref={startRef}
                type="datetime-local"
                required
                value={start}
                onChange={(e) => onChangeStart(e.target.value)}
                onClick={() => openPicker(startRef.current)}
                className="block w-full cursor-pointer rounded-lg border border-line/20 bg-black pl-10 pr-3 py-2 text-sm text-fg [color-scheme:dark] focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
              />
            </div>
          </label>
          <label className="block text-sm text-muted">
            {t("adminTimeOff.end")}
            <div className="relative mt-1">
              <button
                type="button"
                onClick={() => openPicker(endRef.current)}
                className="absolute left-2 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-surface hover:text-sky-300"
                tabIndex={-1}
                aria-label="Открыть календарь"
                title="Открыть календарь"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </button>
              <input
                ref={endRef}
                type="datetime-local"
                required
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                onClick={() => openPicker(endRef.current)}
                className="block w-full cursor-pointer rounded-lg border border-line/20 bg-black pl-10 pr-3 py-2 text-sm text-fg [color-scheme:dark] focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
              />
            </div>
          </label>
        </div>

        {dur && (
          <p className="-mt-1 text-xs text-muted">
            Длительность блока: <span className="text-fg">{dur}</span>
          </p>
        )}
        {start && end && new Date(end).getTime() <= new Date(start).getTime() && (
          <p className="-mt-1 text-xs text-amber-300">
            ⚠ Конец должен быть позже начала.
          </p>
        )}

        <label className="block text-sm text-muted">
          {t("adminTimeOff.reason")}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="например: больничный, отпуск, личное"
            className="mt-1 block w-full rounded-lg border border-line/20 bg-black px-3 py-2 text-fg placeholder:text-muted focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
          />
        </label>
        <button
          type="submit"
          disabled={!staffId || !start || !end || new Date(end).getTime() <= new Date(start).getTime()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-fg transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("common.add")}
        </button>
      </form>

      <ul className="space-y-2">
        {blocks.map((b) => {
          const st = staffList.find((s) => s.id === b.staff_id);
          return (
            <li
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/15 bg-panel px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-fg">{st?.name ?? b.staff_id}</span>
                <span className="text-muted">
                  {" "}
                  {format(parseISO(b.start_time), "Pp")} – {format(parseISO(b.end_time), "Pp")}
                </span>
                {b.reason && <p className="text-xs text-muted">{b.reason}</p>}
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
