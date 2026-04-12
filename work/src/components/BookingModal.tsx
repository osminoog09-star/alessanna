import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import type { StaffMember, StaffServiceRow, ServiceListingRow, StaffScheduleRow, StaffTimeOffRow } from "../types/database";
import { staffEligibleForService, servicesEligibleForStaff } from "../lib/roles";
import { eurFromEuroAmount } from "../lib/format";
import { listingSlotMinutes } from "../lib/serviceListing";
import { overlapsExistingAppointments } from "../lib/slots";
import { isIntervalInsideWorkingWindows, overlapsTimeOff, workingMinuteWindowsForDay } from "../lib/salonCalendar";
import { computeSequentialSegments, type ServiceStaffPick } from "../lib/appointmentChain";
import { resolveClientIdForVisit } from "../lib/clientLink";

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
  services: ServiceListingRow[];
  links?: StaffServiceRow[];
  lockStaff?: boolean;
  variant?: "default" | "pro";
  schedules: StaffScheduleRow[];
  timeOffRows: StaffTimeOffRow[];
};

type BusyLine = { start_time: string; end_time: string; staff_id: string };

export function BookingModal({
  open,
  onClose,
  onSaved,
  initialStart,
  initialStaffId,
  staffList,
  services,
  links = [],
  lockStaff = false,
  variant = "default",
  schedules,
  timeOffRows,
}: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [lineServiceIds, setLineServiceIds] = useState<string[]>([]);
  const [staffByServiceId, setStaffByServiceId] = useState<Record<string, string>>({});
  const [startStr, setStartStr] = useState(() => toLocalDatetimeValue(initialStart));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const initialStaffRow = useMemo(
    () => staffList.find((e) => e.id === initialStaffId) ?? null,
    [staffList, initialStaffId]
  );

  const eligibleServices = useMemo(() => {
    if (lockStaff)
      return servicesEligibleForStaff(services, links, initialStaffId, initialStaffRow);
    return services.filter((s) => s.is_active);
  }, [services, links, lockStaff, initialStaffId, initialStaffRow]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setClientName("");
    setClientPhone("");
    setError("");
    setLineServiceIds([]);
    setStaffByServiceId({});
    setStartStr(toLocalDatetimeValue(initialStart));
  }, [open, initialStart]);

  useEffect(() => {
    if (!open || step !== 2) return;
    setStaffByServiceId((prev) => {
      const next = { ...prev };
      for (const sid of lineServiceIds) {
        if (!next[sid]) {
          const elig = staffEligibleForService(staffList, links, sid).filter((e) => e.active);
          next[sid] = lockStaff ? initialStaffId : elig[0]?.id ?? initialStaffId;
        }
      }
      for (const k of Object.keys(next)) {
        if (!lineServiceIds.includes(k)) delete next[k];
      }
      return next;
    });
  }, [open, step, lineServiceIds, staffList, links, lockStaff, initialStaffId]);

  const picksOrdered: ServiceStaffPick[] = useMemo(
    () => lineServiceIds.map((serviceId) => ({ serviceId, staffId: staffByServiceId[serviceId] ?? initialStaffId })),
    [lineServiceIds, staffByServiceId, initialStaffId]
  );

  const chainStart = parseLocalDatetimeValue(startStr);
  const planned = useMemo(() => {
    if (!chainStart || picksOrdered.length === 0) return null;
    return computeSequentialSegments(chainStart, picksOrdered, services);
  }, [chainStart, picksOrdered, services]);

  if (!open) return null;

  function toggleServiceLine(serviceId: string, checked: boolean) {
    setLineServiceIds((prev) => {
      if (checked) return prev.includes(serviceId) ? prev : [...prev, serviceId];
      return prev.filter((x) => x !== serviceId);
    });
  }

  function removeServiceLine(serviceId: string) {
    setLineServiceIds((prev) => prev.filter((x) => x !== serviceId));
  }

  function goNextFromStep1() {
    setError("");
    if (lineServiceIds.length === 0) {
      setError(t("booking.pickAtLeastOneService"));
      return;
    }
    setStep(2);
  }

  function goNextFromStep2() {
    setError("");
    for (const sid of lineServiceIds) {
      const sidStaff = staffByServiceId[sid];
      if (!sidStaff) {
        setError(t("modal.pickStaff"));
        return;
      }
      const elig = staffEligibleForService(staffList, links, sid).filter((e) => e.active);
      if (lockStaff && sidStaff !== initialStaffId) {
        setError(t("modal.pickStaff"));
        return;
      }
      if (!lockStaff && !elig.some((e) => e.id === sidStaff)) {
        setError(t("modal.pickStaff"));
        return;
      }
    }
    setStep(3);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientName.trim()) {
      setError(t("modal.fillAll"));
      return;
    }
    const start = parseLocalDatetimeValue(startStr);
    if (!start) {
      setError(t("modal.fillAll"));
      return;
    }
    const segments = computeSequentialSegments(start, picksOrdered, services);
    if (!segments?.length) {
      setError(t("modal.pickService"));
      return;
    }

    for (const seg of segments) {
      const windows = workingMinuteWindowsForDay(schedules, seg.staffId, seg.start.getDay());
      if (!isIntervalInsideWorkingWindows(seg.start, seg.end, windows, seg.start)) {
        setError(t("modal.outsideWorkingHours"));
        return;
      }
      if (overlapsTimeOff(seg.start, seg.end, seg.staffId, timeOffRows)) {
        setError(t("modal.timeOffOverlap"));
        return;
      }
    }

    const staffIds = [...new Set(segments.map((s) => s.staffId))];
    setSaving(true);
    const { data: busyRaw, error: loadErr } = await supabase
      .from("appointment_services")
      .select("start_time, end_time, staff_id, appointments!inner(status)")
      .in("staff_id", staffIds)
      .limit(2000);
    if (loadErr) {
      setSaving(false);
      setError(t("auth.error.rpcFailed", { message: loadErr.message }));
      return;
    }
    const busy = (busyRaw ?? []) as Array<BusyLine & { appointments: { status: string } | null }>;
    const activeBusy: BusyLine[] = busy
      .filter((r) => r.appointments?.status !== "cancelled")
      .map((r) => ({ start_time: r.start_time, end_time: r.end_time, staff_id: r.staff_id }));

    for (const seg of segments) {
      const rows = activeBusy
        .filter((r) => r.staff_id === seg.staffId)
        .map((r) => ({ start_time: r.start_time, end_time: r.end_time }));
      if (overlapsExistingAppointments(seg.start, seg.end, rows)) {
        setSaving(false);
        setError(t("modal.overlap"));
        return;
      }
    }

    const clientId = await resolveClientIdForVisit(clientName.trim(), clientPhone.trim() || null);

    const { data: apRow, error: apErr } = await supabase
      .from("appointments")
      .insert({
        client_name: clientName.trim(),
        client_phone: clientPhone.trim() || null,
        client_id: clientId,
        status: "confirmed",
        source: "manual",
      })
      .select("id")
      .single();

    if (apErr || !apRow?.id) {
      setSaving(false);
      setError(t("auth.error.rpcFailed", { message: apErr?.message ?? "insert" }));
      return;
    }

    const appointmentId = apRow.id as string;
    const lineInserts = segments.map((seg) => ({
      appointment_id: appointmentId,
      service_id: seg.serviceId,
      staff_id: seg.staffId,
      start_time: seg.start.toISOString(),
      end_time: seg.end.toISOString(),
    }));

    const { error: lineErr } = await supabase.from("appointment_services").insert(lineInserts);
    if (lineErr) {
      setSaving(false);
      setError(t("auth.error.rpcFailed", { message: lineErr.message }));
      return;
    }
    setSaving(false);
    onSaved();
    onClose();
  }

  const shell =
    variant === "pro"
      ? "border border-amber-500/25 bg-zinc-950/90 shadow-[0_0_60px_rgba(245,158,11,0.12),0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
      : "border border-zinc-800 bg-zinc-950 shadow-2xl";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]">
      <div className={`w-full max-w-lg rounded-2xl p-6 ${shell}`}>
        <h2 className="text-lg font-semibold text-white">{t("modal.newBooking")}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t("booking.stepLabel", { current: step, total: 3 })}
        </p>

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-zinc-400">{t("booking.step1Title")}</p>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 p-2">
              {eligibleServices.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900/80"
                >
                  <input
                    type="checkbox"
                    checked={lineServiceIds.includes(s.id)}
                    onChange={(e) => toggleServiceLine(s.id, e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm text-zinc-200">
                    {s.name} · {eurFromEuroAmount(Number(s.price ?? 0))} ({listingSlotMinutes(s)} {t("common.min")})
                  </span>
                </label>
              ))}
            </div>
            {lineServiceIds.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                <p className="text-xs font-medium text-zinc-500">{t("booking.selectedServices")}</p>
                <ul className="mt-1 space-y-1">
                  {lineServiceIds.map((id) => {
                    const s = services.find((x) => x.id === id);
                    return (
                      <li key={id} className="flex items-center justify-between text-sm text-zinc-300">
                        <span>{s?.name ?? id}</span>
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:text-red-300"
                          onClick={() => removeServiceLine(id)}
                        >
                          {t("common.cancel")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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
                type="button"
                onClick={goNextFromStep1}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                {t("booking.next")}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-zinc-400">{t("booking.step2Title")}</p>
            <div className="space-y-3">
              {lineServiceIds.map((sid) => {
                const s = services.find((x) => x.id === sid);
                const elig = staffEligibleForService(staffList, links, sid).filter((e) => e.active);
                return (
                  <div key={sid}>
                    <label className="text-xs text-zinc-500">{s?.name ?? sid}</label>
                    <select
                      value={staffByServiceId[sid] ?? ""}
                      disabled={lockStaff}
                      onChange={(e) =>
                        setStaffByServiceId((prev) => ({ ...prev, [sid]: e.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white disabled:opacity-70"
                    >
                      {elig.map((em) => (
                        <option key={em.id} value={em.id}>
                          {em.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                {t("booking.back")}
              </button>
              <button
                type="button"
                onClick={goNextFromStep2}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                {t("booking.next")}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <p className="text-sm text-zinc-400">{t("booking.step3Title")}</p>
            <div>
              <label className="text-xs text-zinc-500">{t("modal.startTime")}</label>
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </div>
            {planned && planned.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-xs font-medium text-zinc-500">{t("booking.timeChain")}</p>
                <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                  {planned.map((seg, i) => {
                    const s = services.find((x) => x.id === seg.serviceId);
                    const st = staffList.find((x) => x.id === seg.staffId);
                    return (
                      <li key={i}>
                        {seg.start.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {seg.end.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {s?.name} · {st?.name}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <div>
              <label className="text-xs text-zinc-500">{t("modal.client")}</label>
              <input
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">{t("modal.phone")}</label>
              <input
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                {t("booking.back")}
              </button>
              <button
                type="submit"
                disabled={saving || !planned?.length}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  variant === "pro"
                    ? "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400"
                    : "bg-sky-600 hover:bg-sky-500"
                }`}
              >
                {t("common.save")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
