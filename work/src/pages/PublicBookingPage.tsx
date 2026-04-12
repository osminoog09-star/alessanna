import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { generateAvailableSlots, formatSlotRange, overlapsExistingAppointments } from "../lib/slots";
import { normalizeStaffMember, staffEligibleForService } from "../lib/roles";
import { computeSequentialSegments } from "../lib/appointmentChain";
import { isIntervalInsideWorkingWindows, overlapsTimeOff, workingMinuteWindowsForDay } from "../lib/salonCalendar";
import { eurFromCents } from "../lib/format";
import type {
  ServiceRow,
  StaffMember,
  StaffScheduleRow,
  StaffServiceRow,
  StaffTimeOffRow,
} from "../types/database";

type Step = 1 | 2 | 3;

type BusyLike = { staff_id: string; start_time: string; end_time: string };

export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [busyLines, setBusyLines] = useState<BusyLike[]>([]);

  const [step, setStep] = useState<Step>(1);
  const [lineServiceIds, setLineServiceIds] = useState<number[]>([]);
  const [staffByServiceId, setStaffByServiceId] = useState<Record<number, string>>({});

  const [dayStr, setDayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [sv, st, lk, sc, to] = await Promise.all([
      supabase.from("services").select("*").eq("active", true).order("sort_order"),
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
    ]);
    if (sv.data) setServices(sv.data as ServiceRow[]);
    if (st.data) {
      setStaff((st.data as Record<string, unknown>[]).map((r) => normalizeStaffMember(r as StaffMember)));
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    if (sc.data) setSchedules(sc.data as StaffScheduleRow[]);
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const firstServiceId = lineServiceIds[0];
  const firstStaffId = firstServiceId != null ? staffByServiceId[firstServiceId] : null;

  const day = useMemo(() => startOfDay(new Date(dayStr + "T12:00:00")), [dayStr]);

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured() || !firstStaffId) return;
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const { data } = await supabase
      .from("appointment_services")
      .select("staff_id, start_time, end_time, appointments!inner(status)")
      .eq("staff_id", firstStaffId)
      .gte("start_time", start.toISOString())
      .lte("start_time", end.toISOString());
    const raw = (data ?? []) as Array<BusyLike & { appointments: { status: string } | null }>;
    setBusyLines(
      raw
        .filter((r) => r.appointments?.status !== "cancelled")
        .map((r) => ({ staff_id: r.staff_id, start_time: r.start_time, end_time: r.end_time }))
    );
  }, [day, firstStaffId]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  useEffect(() => {
    if (step !== 2) return;
    setStaffByServiceId((prev) => {
      const next = { ...prev };
      for (const sid of lineServiceIds) {
        if (!next[sid]) {
          const elig = staffEligibleForService(staff, links, sid).filter((e) => e.active);
          next[sid] = elig[0]?.id ?? "";
        }
      }
      for (const k of Object.keys(next)) {
        const id = Number(k);
        if (!lineServiceIds.includes(id)) delete next[id];
      }
      return next;
    });
  }, [step, lineServiceIds, staff, links]);

  const firstSvc = firstServiceId != null ? services.find((s) => s.id === firstServiceId) : null;
  const durationMin = firstSvc ? firstSvc.duration_min + firstSvc.buffer_after_min : 60;

  const staffScheduleForGen = useMemo(() => {
    if (!firstStaffId) return [];
    return schedules
      .filter((s) => s.staff_id === firstStaffId)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }));
  }, [schedules, firstStaffId]);

  const slots = useMemo(() => {
    if (!firstStaffId || !firstSvc) return [];
    return generateAvailableSlots({
      schedule: staffScheduleForGen,
      appointments: busyLines,
      timeOff,
      duration: durationMin,
      day,
      stepMinutes: 15,
      staffId: firstStaffId,
    });
  }, [firstStaffId, firstSvc, staffScheduleForGen, busyLines, timeOff, durationMin, day]);

  const picksOrdered = useMemo(
    () => lineServiceIds.map((serviceId) => ({ serviceId, staffId: staffByServiceId[serviceId] ?? "" })),
    [lineServiceIds, staffByServiceId]
  );

  const planned = useMemo(() => {
    if (!pickedStart || picksOrdered.some((p) => !p.staffId)) return null;
    return computeSequentialSegments(pickedStart, picksOrdered, services);
  }, [pickedStart, picksOrdered, services]);

  function toggleServiceLine(serviceId: number, checked: boolean) {
    setErr(null);
    setMsg(null);
    setLineServiceIds((prev) => {
      if (checked) return prev.includes(serviceId) ? prev : [...prev, serviceId];
      return prev.filter((x) => x !== serviceId);
    });
    setPickedStart(null);
  }

  function removeServiceLine(serviceId: number) {
    setErr(null);
    setMsg(null);
    setLineServiceIds((prev) => prev.filter((x) => x !== serviceId));
    setPickedStart(null);
  }

  function goStep2() {
    setErr(null);
    setMsg(null);
    if (lineServiceIds.length === 0) {
      setErr(t("booking.pickAtLeastOneService"));
      return;
    }
    setStep(2);
  }

  function goStep3() {
    setErr(null);
    setMsg(null);
    for (const sid of lineServiceIds) {
      const sidStaff = staffByServiceId[sid];
      if (!sidStaff) {
        setErr(t("modal.pickStaff"));
        return;
      }
      const elig = staffEligibleForService(staff, links, sid).filter((e) => e.active);
      if (!elig.some((e) => e.id === sidStaff)) {
        setErr(t("modal.pickStaff"));
        return;
      }
    }
    setStep(3);
    setPickedStart(null);
  }

  async function confirmBook() {
    setErr(null);
    setMsg(null);
    if (!pickedStart || !clientName.trim()) {
      setErr(t("publicBook.fillAll"));
      return;
    }
    const segments = computeSequentialSegments(pickedStart, picksOrdered, services);
    if (!segments?.length) {
      setErr(t("modal.pickService"));
      return;
    }

    for (const seg of segments) {
      const windows = workingMinuteWindowsForDay(schedules, seg.staffId, seg.start.getDay());
      if (!isIntervalInsideWorkingWindows(seg.start, seg.end, windows, seg.start)) {
        setErr(t("modal.outsideWorkingHours"));
        return;
      }
      if (overlapsTimeOff(seg.start, seg.end, seg.staffId, timeOff)) {
        setErr(t("modal.timeOffOverlap"));
        return;
      }
    }

    const staffIds = [...new Set(segments.map((s) => s.staffId))];
    setBooking(true);
    try {
      const { data: busyRaw, error: loadErr } = await supabase
        .from("appointment_services")
        .select("start_time, end_time, staff_id, appointments!inner(status)")
        .in("staff_id", staffIds)
        .limit(2000);
      if (loadErr) {
        setErr(loadErr.message);
        return;
      }
      const busy = (busyRaw ?? []) as Array<BusyLike & { appointments: { status: string } | null }>;
      const activeBusy: BusyLike[] = busy
        .filter((r) => r.appointments?.status !== "cancelled")
        .map((r) => ({ start_time: r.start_time, end_time: r.end_time, staff_id: r.staff_id }));

      for (const seg of segments) {
        const rows = activeBusy
          .filter((r) => r.staff_id === seg.staffId)
          .map((r) => ({ start_time: r.start_time, end_time: r.end_time }));
        if (overlapsExistingAppointments(seg.start, seg.end, rows)) {
          setErr(t("modal.overlap"));
          return;
        }
      }

      const { data: apRow, error: apErr } = await supabase
        .from("appointments")
        .insert({
          client_name: clientName.trim(),
          client_phone: clientPhone.trim() || null,
          status: "confirmed",
          source: "online",
        })
        .select("id")
        .single();

      if (apErr || !apRow?.id) {
        setErr(apErr?.message ?? "insert");
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
        setErr(lineErr.message);
        return;
      }
      setMsg(t("publicBook.success"));
      setPickedStart(null);
      setClientName("");
      setClientPhone("");
      setStep(1);
      setLineServiceIds([]);
      setStaffByServiceId({});
      void loadDayData();
    } finally {
      setBooking(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8 text-zinc-300">
        <p>{t("login.configLine")}</p>
        <Link className="mt-4 block text-sky-400" to="/login">
          Staff login
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-200">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold text-white">{t("publicBook.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("publicBook.subtitle")}</p>
        <p className="mt-1 text-xs text-zinc-600">
          {t("booking.stepLabel", { current: step, total: 3 })}
        </p>
        <Link to="/login" className="mt-2 inline-block text-sm text-sky-400">
          {t("publicBook.staffLogin")}
        </Link>

        <div className="mt-8 space-y-6">
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">{t("booking.step1Title")}</p>
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 p-2">
                {services.map((s) => (
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
                      {s.name_et} · {eurFromCents(s.price_cents)} ({s.duration_min}+{s.buffer_after_min}{" "}
                      {t("common.min")})
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
                          <span>{s?.name_et ?? id}</span>
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
              {err && <p className="text-sm text-red-400">{err}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={goStep2}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                >
                  {t("booking.next")}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">{t("booking.step2Title")}</p>
              <div className="space-y-3">
                {lineServiceIds.map((sid) => {
                  const s = services.find((x) => x.id === sid);
                  const elig = staffEligibleForService(staff, links, sid).filter((e) => e.active);
                  return (
                    <div key={sid}>
                      <label className="text-xs text-zinc-500">{s?.name_et ?? sid}</label>
                      <select
                        value={staffByServiceId[sid] ?? ""}
                        onChange={(e) =>
                          setStaffByServiceId((prev) => ({ ...prev, [sid]: e.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                      >
                        <option value="">{t("publicBook.pickStaff")}</option>
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
              {err && <p className="text-sm text-red-400">{err}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setErr(null);
                    setStep(1);
                  }}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                >
                  {t("booking.back")}
                </button>
                <button
                  type="button"
                  onClick={goStep3}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
                >
                  {t("booking.next")}
                </button>
              </div>
            </div>
          )}

          {step === 3 && firstStaffId && firstSvc && (
            <>
              <label className="block text-sm">
                <span className="text-zinc-400">{t("publicBook.day")}</span>
                <input
                  type="date"
                  value={dayStr}
                  onChange={(e) => {
                    setDayStr(e.target.value);
                    setPickedStart(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
                />
              </label>

              <div>
                <p className="text-sm text-zinc-400">{t("publicBook.slots")}</p>
                <p className="mt-1 text-xs text-zinc-600">{t("publicBook.slotsFirstServiceHint")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start.toISOString()}
                      type="button"
                      onClick={() => {
                        setErr(null);
                        setPickedStart(s.start);
                      }}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        pickedStart?.getTime() === s.start.getTime()
                          ? "border-sky-500 bg-sky-950/50 text-white"
                          : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {formatSlotRange(s)}
                    </button>
                  ))}
                </div>
                {slots.length === 0 && <p className="mt-2 text-xs text-zinc-600">{t("publicBook.noSlots")}</p>}
              </div>

              {pickedStart && planned && planned.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <p className="text-xs font-medium text-zinc-500">{t("booking.timeChain")}</p>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                    {planned.map((seg, i) => {
                      const s = services.find((x) => x.id === seg.serviceId);
                      const st = staff.find((x) => x.id === seg.staffId);
                      return (
                        <li key={i}>
                          {seg.start.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} –{" "}
                          {seg.end.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} ·{" "}
                          {s?.name_et} · {st?.name}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {pickedStart && (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <input
                    placeholder={t("modal.client") as string}
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
                  />
                  <input
                    placeholder={t("modal.phone") as string}
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm"
                  />
                  {err && <p className="text-sm text-red-400">{err}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setErr(null);
                        setStep(2);
                      }}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                    >
                      {t("booking.back")}
                    </button>
                    <button
                      type="button"
                      disabled={booking}
                      onClick={() => void confirmBook()}
                      className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {t("publicBook.confirm")}
                    </button>
                  </div>
                </div>
              )}

              {!pickedStart && (
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => {
                      setErr(null);
                      setStep(2);
                    }}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
                  >
                    {t("booking.back")}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 3 && (!firstStaffId || !firstSvc) && (
            <p className="text-sm text-amber-400">{t("modal.pickStaff")}</p>
          )}

          {msg && <p className="text-sm text-emerald-400/90">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
