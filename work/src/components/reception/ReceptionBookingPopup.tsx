import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { addMinutes, format, setHours, setMinutes, startOfDay } from "date-fns";
import { supabase } from "../../lib/supabase";
import { servicesEligibleForStaff } from "../../lib/roles";
import { overlapsExistingAppointments } from "../../lib/slots";
import type { ServiceRow, StaffMember, StaffServiceRow } from "../../types/database";

type Props = {
  anchorX: number;
  anchorY: number;
  initialStart: Date;
  defaultStaffId: string | null;
  staff: StaffMember[];
  services: ServiceRow[];
  links: StaffServiceRow[];
  onSave: () => void;
  onClose: () => void;
};

const POPUP_W = 340;
const POPUP_H = 460;

function timeToStr(date: Date): string {
  return format(date, "HH:mm");
}

function applyTimeStr(base: Date, timeStr: string): Date {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return base;
  return setMinutes(setHours(startOfDay(base), h), m);
}

export function ReceptionBookingPopup({
  anchorX,
  anchorY,
  initialStart,
  defaultStaffId,
  staff,
  services,
  links,
  onSave,
  onClose,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [staffId, setStaffId] = useState<string>(() => defaultStaffId ?? staff[0]?.id ?? "");
  const [serviceId, setServiceId] = useState<string>("");
  const [startStr, setStartStr] = useState(() => timeToStr(initialStart));
  const [endStr, setEndStr] = useState(() => timeToStr(addMinutes(initialStart, 60)));
  const [endManual, setEndManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const left = Math.min(anchorX + 8, window.innerWidth - POPUP_W - 8);
  const top = Math.max(8, Math.min(anchorY - 8, window.innerHeight - POPUP_H - 8));

  const selectedStaff = useMemo(
    () => staff.find((s) => s.id === staffId) ?? null,
    [staff, staffId],
  );

  const eligibleServices = useMemo(
    () => servicesEligibleForStaff(services, links, staffId, selectedStaff),
    [services, links, staffId, selectedStaff],
  );

  const svc = useMemo(
    () => eligibleServices.find((s) => String(s.id) === serviceId) ?? null,
    [eligibleServices, serviceId],
  );

  // Initialize serviceId
  useEffect(() => {
    if (!serviceId && eligibleServices.length > 0) {
      setServiceId(String(eligibleServices[0]!.id));
    }
  }, [eligibleServices, serviceId]);

  // Reset service if no longer eligible
  useEffect(() => {
    if (serviceId && !eligibleServices.some((s) => String(s.id) === serviceId)) {
      setServiceId(eligibleServices[0] ? String(eligibleServices[0].id) : "");
    }
  }, [staffId, eligibleServices, serviceId]);

  // Auto-compute end when service changes (unless user manually set end)
  useEffect(() => {
    if (endManual) return;
    const dur = svc ? svc.duration_min + svc.buffer_after_min : 60;
    const start = applyTimeStr(initialStart, startStr);
    setEndStr(timeToStr(addMinutes(start, dur)));
  }, [svc, startStr, initialStart, endManual]);

  function handleStartChange(val: string) {
    setStartStr(val);
    if (!endManual && svc) {
      const dur = svc.duration_min + svc.buffer_after_min;
      setEndStr(timeToStr(addMinutes(applyTimeStr(initialStart, val), dur)));
    }
  }

  function handleEndChange(val: string) {
    setEndStr(val);
    setEndManual(true);
  }

  // Close on Escape or click outside
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  const dateLabel = initialStart.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!svc) { setError("Выберите услугу"); return; }
    if (!staffId) { setError("Выберите мастера"); return; }

    const start = applyTimeStr(initialStart, startStr);
    const end = applyTimeStr(initialStart, endStr);

    if (end <= start) { setError("Время окончания должно быть позже начала"); return; }

    setSaving(true);
    setError("");

    const { data: existingRows, error: loadErr } = await supabase
      .from("appointments")
      .select("start_time, end_time")
      .eq("staff_id", staffId)
      .neq("status", "cancelled")
      .limit(500);

    if (loadErr) { setSaving(false); setError(loadErr.message); return; }

    if (
      overlapsExistingAppointments(
        start,
        end,
        (existingRows ?? []) as { start_time: string; end_time: string }[],
      )
    ) {
      setSaving(false);
      setError("Время занято, выберите другой слот.");
      return;
    }

    const { error: insErr } = await supabase.from("appointments").insert({
      client_name: clientName.trim() || "Клиент (ресепшен)",
      client_phone: clientPhone.trim() || null,
      note: null,
      staff_id: staffId,
      service_id: svc.id,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    });

    setSaving(false);
    if (insErr) { setError(insErr.message); return; }
    onSave();
  }

  return (
    <div
      ref={popupRef}
      style={{ left, top, width: POPUP_W }}
      className="fixed z-50 overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between bg-zinc-800 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">Новая запись</span>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label="Закрыть"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 p-4">
        {/* Client name */}
        <input
          autoFocus
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Добавьте клиента"
          className="w-full border-0 border-b border-zinc-700 bg-transparent pb-1 text-base font-medium text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
        />

        {/* Date + time row */}
        <div className="flex items-start gap-3">
          <svg viewBox="0 0 20 20" className="mt-2 h-4 w-4 shrink-0 text-zinc-500" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="mb-1 text-sm font-medium capitalize text-zinc-300">{dateLabel}</p>
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <label className="mb-0.5 text-[10px] text-zinc-500">Начало</label>
                <input
                  type="time"
                  value={startStr}
                  onChange={(e) => handleStartChange(e.target.value)}
                  className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <span className="mt-4 text-zinc-500">—</span>
              <div className="flex flex-col">
                <label className="mb-0.5 flex items-center gap-1 text-[10px] text-zinc-500">
                  Конец
                  {endManual && (
                    <button
                      type="button"
                      onClick={() => { setEndManual(false); }}
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                      title="Сбросить к автоматическому"
                    >
                      ↺
                    </button>
                  )}
                </label>
                <input
                  type="time"
                  value={endStr}
                  onChange={(e) => handleEndChange(e.target.value)}
                  className={[
                    "w-24 rounded-lg border px-2 py-1 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none",
                    endManual ? "border-amber-600 bg-amber-950/30" : "border-zinc-700 bg-zinc-800",
                  ].join(" ")}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Staff selector */}
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="currentColor">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
          <select
            value={staffId}
            onChange={(e) => { setStaffId(e.target.value); setServiceId(""); setEndManual(false); }}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
          >
            {staff.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Service selector */}
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="currentColor">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
          </svg>
          <select
            value={serviceId}
            onChange={(e) => { setServiceId(e.target.value); setEndManual(false); }}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">— услуга —</option>
            {eligibleServices.map((s) => (
              <option key={String(s.id)} value={String(s.id)}>
                {s.name_et} ({s.duration_min} мин)
              </option>
            ))}
          </select>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-zinc-500" fill="currentColor">
            <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
          </svg>
          <input
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="Телефон (необязательно)"
            type="tel"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving || !serviceId || !staffId}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
