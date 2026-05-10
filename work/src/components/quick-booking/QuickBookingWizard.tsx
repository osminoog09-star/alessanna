import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { supabase } from "../../lib/supabase";
import { generateDaySlots, type Slot } from "../../lib/slots";
import {
  compareSalonYmd,
  isSalonBookableYmd,
  normalizePublicBookingDayStr,
  salonDayStartUtc,
  salonFirstBookableYmd,
  salonWeekdaySun0,
  salonYmdFromAnyDate,
  SALON_TIME_ZONE,
} from "../../lib/bookingSalonTz";
import { resolveClientIdForVisit } from "../../lib/clientLink";
import { useQuickBookingResources } from "../../hooks/useQuickBookingResources";
import { buildQuickCategories } from "./buildQuickCategories";
import type { StaffMember } from "../../types/database";

const ANY_MASTER_ID = "any";

type WizardStep =
  | "intro"
  | "category"
  | "service"
  | "masterMode"
  | "masterPick"
  | "timeMode"
  | "schedule"
  | "client"
  | "confirm";

type MasterMode = "specific" | "any" | "nearest";

type TimeMode = "soonest" | "pick_day";

type Props = {
  createdByStaffId: string;
};

type ClientHit = { id: string; name: string; phone: string | null };

function bigBtnClass(active?: boolean) {
  return [
    "flex min-h-[56px] w-full items-center justify-center rounded-2xl border px-4 text-lg font-semibold transition",
    active
      ? "border-sky-400/80 bg-sky-500/20 text-white shadow-[0_0_40px_rgba(56,189,248,0.15)]"
      : "border-white/10 bg-white/5 text-zinc-100 hover:border-white/20 hover:bg-white/10",
  ].join(" ");
}

export function QuickBookingWizard({ createdByStaffId }: Props) {
  const { t, i18n } = useTranslation();
  const {
    loading,
    services,
    staffDirectory,
    schedules,
    appointments,
    timeOff,
    setBookYmd,
    bookYmdNorm,
    nowTick,
    loadDayData,
    eligibleStaffForService,
  } = useQuickBookingResources();

  const [history, setHistory] = useState<WizardStep[]>(["intro"]);
  const step = history[history.length - 1];

  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [masterMode, setMasterMode] = useState<MasterMode | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<TimeMode | null>(null);
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientNote, setClientNote] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<ClientHit[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);

  const push = useCallback((s: WizardStep) => {
    setHistory((h) => [...h, s]);
  }, []);

  const goBack = useCallback(() => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
    setMsg(null);
  }, []);

  const resetFlow = useCallback(() => {
    setHistory(["intro"]);
    setCategoryKey(null);
    setServiceId(null);
    setMasterMode(null);
    setStaffId(null);
    setTimeMode(null);
    setPickedStart(null);
    setClientName("");
    setClientPhone("");
    setClientNote("");
    setClientQuery("");
    setClientHits([]);
    setMsg(null);
  }, []);

  const categories = useMemo(
    () => buildQuickCategories(services, t("quickBook.otherCategory")),
    [services, t],
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryKey) ?? null,
    [categories, categoryKey],
  );

  const categoryServices = useMemo(() => {
    if (!selectedCategory) return [];
    const idset = new Set(selectedCategory.serviceIds);
    return services.filter((s) => idset.has(s.id) && s.active);
  }, [selectedCategory, services]);

  const svc = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId]);

  const durationMin = svc ? svc.duration_min + svc.buffer_after_min : 60;

  const eligibleStaff = useMemo(
    () => (serviceId ? eligibleStaffForService(serviceId) : []),
    [eligibleStaffForService, serviceId],
  );

  const salonDayStart = useMemo(() => salonDayStartUtc(bookYmdNorm), [bookYmdNorm]);

  /** Все слоты по графику: `available: false` = запись или time off на этот интервал. */
  const allSlotsByStaff = useMemo(() => {
    if (!svc) return new Map<string, Slot[]>();
    const out = new Map<string, Slot[]>();
    for (const member of eligibleStaff) {
      const memberSchedule = schedules
        .filter((s) => s.staff_id === member.id)
        .map((s) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
        }));
      const raw = generateDaySlots({
        schedule: memberSchedule,
        appointments,
        timeOff,
        duration: durationMin,
        day: salonDayStart,
        salonDayStartUtc: salonDayStart,
        salonWeekdaySun0: salonWeekdaySun0(bookYmdNorm),
        stepMinutes: 15,
        staffId: member.id,
      });
      out.set(member.id, raw);
    }
    return out;
  }, [appointments, bookYmdNorm, durationMin, eligibleStaff, schedules, salonDayStart, svc, timeOff]);

  /** Только свободные и не в прошлом — для автоподбора и подтверждения. */
  const slotsByStaff = useMemo(() => {
    const out = new Map<string, Slot[]>();
    for (const [id, arr] of allSlotsByStaff) {
      out.set(
        id,
        arr.filter((s) => s.available && s.start.getTime() >= nowTick),
      );
    }
    return out;
  }, [allSlotsByStaff, nowTick]);

  /** Сетка времени: свободные + занятые (и прошедшие), чтобы видеть «дыры» из записей / выходных. */
  const scheduleDisplaySlots = useMemo(() => {
    if (!svc) return [];
    if (staffId && staffId !== ANY_MASTER_ID) {
      const arr = allSlotsByStaff.get(staffId) || [];
      return [...arr].sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    const byStart = new Map<string, Slot>();
    for (const arr of allSlotsByStaff.values()) {
      for (const s of arr) {
        const key = s.start.toISOString();
        const ex = byStart.get(key);
        if (!ex) byStart.set(key, { ...s });
        else ex.available = ex.available || s.available;
      }
    }
    return Array.from(byStart.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [allSlotsByStaff, staffId, svc]);

  const earliestAcrossMastersSlot = useMemo(() => {
    let best: Slot | null = null;
    for (const m of eligibleStaff) {
      const arr = slotsByStaff.get(m.id);
      if (!arr?.length) continue;
      const first = arr[0];
      if (!best || first.start.getTime() < best.start.getTime()) best = first;
    }
    return best;
  }, [eligibleStaff, slotsByStaff]);

  /** Ближайший слот с учётом режима мастера (конкретный / любой). */
  const soonestForMasterMode = useMemo(() => {
    if (masterMode === "specific" && staffId && staffId !== ANY_MASTER_ID) {
      return slotsByStaff.get(staffId)?.[0] ?? null;
    }
    return earliestAcrossMastersSlot;
  }, [earliestAcrossMastersSlot, masterMode, slotsByStaff, staffId]);

  const firstBookableYmd = useMemo(() => salonFirstBookableYmd(new Date(nowTick)), [nowTick]);

  const monthStart = useMemo(() => {
    const [y, m] = bookYmdNorm.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [bookYmdNorm]);

  const calendarDays = useMemo(() => {
    const from = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: from, end: to });
  }, [monthStart]);

  /** Фиксированные фазы: один экран — одна «ступень» прогресса (без скачков в середину). */
  const stepPhase = useMemo(() => {
    if (step === "intro") return { n: 0, total: 6, showBar: false as const };
    const phase: Partial<Record<WizardStep, number>> = {
      category: 1,
      service: 2,
      masterMode: 3,
      masterPick: 3,
      timeMode: 4,
      schedule: 4,
      client: 5,
      confirm: 6,
    };
    const n = phase[step] ?? 0;
    return { n, total: 6, showBar: true as const };
  }, [step]);

  useEffect(() => {
    if (!clientQuery.trim() || clientQuery.trim().length < 2) {
      setClientHits([]);
      return;
    }
    const h = window.setTimeout(() => {
      void (async () => {
        setClientSearchLoading(true);
        const q = clientQuery.trim();
        const digits = q.replace(/\D/g, "");
        let query = supabase.from("clients").select("id,name,phone").limit(12);
        if (digits.length >= 3) {
          query = query.or(`name.ilike.%${q}%,phone.ilike.%${digits}%`);
        } else {
          query = query.ilike("name", `%${q}%`);
        }
        const { data, error } = await query;
        setClientSearchLoading(false);
        if (error || !data) {
          setClientHits([]);
          return;
        }
        setClientHits(data as ClientHit[]);
      })();
    }, 280);
    return () => window.clearTimeout(h);
  }, [clientQuery]);

  const applyNearest = useCallback(() => {
    if (!svc) return;
    if (!soonestForMasterMode) {
      setTimeMode("pick_day");
      setPickedStart(null);
      push("schedule");
      setMsg(t("quickBook.noSlotsTodayPickDay"));
      return;
    }
    setStaffId(ANY_MASTER_ID);
    setPickedStart(soonestForMasterMode.start);
    setTimeMode("soonest");
    push("schedule");
  }, [push, soonestForMasterMode, svc, t]);

  const confirmBook = useCallback(async () => {
    if (!svc || !pickedStart) {
      setMsg(t("publicBook.fillAll"));
      return;
    }
    if (!isSalonBookableYmd(bookYmdNorm)) {
      setMsg(t("publicBook.dayNotBookable"));
      return;
    }
    setBooking(true);
    setMsg(null);
    let finalStaffId = staffId && staffId !== ANY_MASTER_ID ? staffId : null;
    if (!finalStaffId) {
      for (const candidate of eligibleStaff) {
        const candidateSlots = slotsByStaff.get(candidate.id) || [];
        if (candidateSlots.some((s) => s.start.getTime() === pickedStart.getTime())) {
          finalStaffId = candidate.id;
          break;
        }
      }
    }
    if (!finalStaffId) {
      setBooking(false);
      setMsg(t("quickBook.noStaffForSlot"));
      return;
    }
    if (pickedStart.getTime() < Date.now()) {
      setBooking(false);
      setMsg(t("quickBook.pastSlot"));
      void loadDayData();
      return;
    }
    const end = new Date(pickedStart.getTime() + durationMin * 60 * 1000);
    const normalizedClientName = clientName.trim() || t("quickBook.receptionClientPlaceholder");
    const row: Record<string, unknown> = {
      staff_id: finalStaffId,
      service_id: svc.id,
      client_name: normalizedClientName,
      client_phone: clientPhone.trim() || null,
      start_time: pickedStart.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
      source: "reception",
      created_by_staff_id: createdByStaffId,
      note: clientNote.trim() || null,
    };
    const cid = await resolveClientIdForVisit(normalizedClientName, clientPhone);
    if (cid) row.client_id = cid;

    const { error } = await supabase.from("appointments").insert(row);
    setBooking(false);
    if (error) {
      if (error.code === "23P01" || /overlap|занят/i.test(String(error.message || ""))) {
        setMsg(t("modal.overlap"));
        void loadDayData();
        return;
      }
      setMsg(error.message);
      return;
    }
    setMsg(t("publicBook.success"));
    resetFlow();
  }, [
    bookYmdNorm,
    clientName,
    clientNote,
    clientPhone,
    createdByStaffId,
    durationMin,
    eligibleStaff,
    loadDayData,
    pickedStart,
    resetFlow,
    slotsByStaff,
    staffId,
    svc,
    t,
  ]);

  const masterForConfirm = useMemo(() => {
    if (!pickedStart || !svc) return null;
    if (staffId && staffId !== ANY_MASTER_ID) {
      return staffDirectory.find((s) => s.id === staffId) ?? null;
    }
    for (const candidate of eligibleStaff) {
      const candidateSlots = slotsByStaff.get(candidate.id) || [];
      if (candidateSlots.some((s) => s.start.getTime() === pickedStart.getTime())) {
        return candidate;
      }
    }
    return null;
  }, [eligibleStaff, pickedStart, slotsByStaff, staffDirectory, staffId, svc]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-xl text-zinc-400">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-16 pt-6 sm:px-4">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={history.length <= 1}
          className="min-h-[48px] min-w-[48px] rounded-xl border border-white/15 bg-white/5 px-4 text-base text-zinc-200 disabled:opacity-30"
        >
          {t("quickBook.back")}
        </button>
        <div className="flex-1">
          {stepPhase.showBar ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-500 transition-all"
                  style={{
                    width: `${Math.min(100, (stepPhase.n / Math.max(1, stepPhase.total)) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-center text-sm text-zinc-500">
                {t("quickBook.stepOf", { n: stepPhase.n, total: stepPhase.total })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-center text-sm text-zinc-500">{t("quickBook.introProgressHint")}</p>
          )}
        </div>
        <Link
          to="/reception"
          className="min-h-[48px] rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-sky-300"
        >
          {t("quickBook.close")}
        </Link>
      </header>

      {msg && (
        <p
          className={`mb-4 rounded-2xl border px-4 py-3 text-lg ${
            msg.includes(t("publicBook.success")) ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200" : "border-amber-500/40 bg-amber-950/25 text-amber-100"
          }`}
        >
          {msg}
        </p>
      )}

      {step === "intro" && (
        <div className="space-y-6">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("quickBook.title")}</h1>
          <p className="text-lg text-zinc-400">{t("quickBook.subtitle")}</p>
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-zinc-300">
            {t("quickBook.linearFlowHint")}
          </p>

          <button type="button" onClick={() => push("category")} className={bigBtnClass()}>
            {t("quickBook.startWizard")}
          </button>
        </div>
      )}

      {step === "category" && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickCategory")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategoryKey(c.id);
                  push("service");
                }}
                className="flex min-h-[72px] items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4 text-left shadow-lg backdrop-blur-md transition hover:border-sky-400/40 hover:bg-white/[0.1]"
              >
                <span className="text-4xl" aria-hidden>
                  {c.emoji}
                </span>
                <span className="text-xl font-medium text-white">{c.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "service" && selectedCategory && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickService")}</h2>
          <div className="grid gap-3">
            {categoryServices.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setServiceId(s.id);
                  push("masterMode");
                }}
                className="flex min-h-[64px] flex-col items-start justify-center rounded-2xl border border-white/10 bg-white/[0.07] px-5 py-4 text-left backdrop-blur-md transition hover:border-violet-400/35"
              >
                <span className="text-xl font-semibold text-white">{s.name}</span>
                <span className="mt-1 text-base text-zinc-400">
                  {s.duration_min} {t("quickBook.min")} ·{" "}
                  {s.priceEur != null ? `€${s.priceEur}` : t("quickBook.priceOnConfirm")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "masterMode" && svc && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickMasterMode")}</h2>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                setMasterMode("specific");
                setStaffId(null);
                push("masterPick");
              }}
              className={bigBtnClass()}
            >
              {t("quickBook.masterSpecific")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMasterMode("any");
                setStaffId(ANY_MASTER_ID);
                push("timeMode");
              }}
              className={bigBtnClass()}
            >
              {t("quickBook.masterAny")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMasterMode("nearest");
                setStaffId(ANY_MASTER_ID);
                applyNearest();
              }}
              className={bigBtnClass()}
            >
              {t("quickBook.masterNearest")}
            </button>
          </div>
        </div>
      )}

      {step === "masterPick" && svc && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickMaster")}</h2>
          <div className="grid gap-3">
            {eligibleStaff.map((m: StaffMember) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setStaffId(m.id);
                  push("timeMode");
                }}
                className="flex min-h-[64px] items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.07] px-5 text-left backdrop-blur-md transition hover:border-sky-400/40"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-sky-500/30 to-violet-500/30 text-lg font-bold text-white">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-xl text-white">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "timeMode" && svc && masterMode !== "nearest" && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickTimeStrategy")}</h2>
          <button
            type="button"
            onClick={() => {
              setTimeMode("soonest");
              if (soonestForMasterMode) {
                setPickedStart(soonestForMasterMode.start);
                if (masterMode === "any") setStaffId(ANY_MASTER_ID);
              } else setPickedStart(null);
              push("schedule");
            }}
            className={bigBtnClass()}
          >
            {t("quickBook.timeSoonest")}
          </button>
          <button
            type="button"
            onClick={() => {
              setTimeMode("pick_day");
              setPickedStart(null);
              push("schedule");
            }}
            className={bigBtnClass()}
          >
            {t("quickBook.timePickDay")}
          </button>
        </div>
      )}

      {step === "schedule" && svc && (
        <div className="space-y-5">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.pickSlot")}</h2>

          {timeMode === "pick_day" && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-3 py-2 text-zinc-200"
                  onClick={() => {
                    const prev = addMonths(monthStart, -1);
                    const y = prev.getFullYear();
                    const mo = prev.getMonth() + 1;
                    setBookYmd(normalizePublicBookingDayStr(`${y}-${String(mo).padStart(2, "0")}-01`));
                  }}
                >
                  ←
                </button>
                <p className="text-lg font-medium text-white">
                  {format(monthStart, "LLLL yyyy", { locale: undefined })}
                </p>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 px-3 py-2 text-zinc-200"
                  onClick={() => {
                    const next = addMonths(monthStart, 1);
                    const y = next.getFullYear();
                    const mo = next.getMonth() + 1;
                    setBookYmd(normalizePublicBookingDayStr(`${y}-${String(mo).padStart(2, "0")}-01`));
                  }}
                >
                  →
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-500">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <div key={d}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {calendarDays.map((d) => {
                  const ymd = salonYmdFromAnyDate(d);
                  const sel = ymd === bookYmdNorm;
                  const inMonth = isSameMonth(d, monthStart);
                  const disabled = compareSalonYmd(ymd, firstBookableYmd) < 0 || !isSalonBookableYmd(ymd);
                  return (
                    <button
                      key={ymd}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled) {
                          setBookYmd(ymd);
                          setPickedStart(null);
                        }
                      }}
                      className={[
                        "min-h-[44px] rounded-lg border text-sm",
                        disabled
                          ? "cursor-not-allowed border-transparent text-zinc-700"
                          : sel
                            ? "border-sky-400 bg-sky-500/25 text-white"
                            : inMonth
                              ? "border-white/10 text-zinc-200 hover:border-white/25"
                              : "border-transparent text-zinc-600",
                      ].join(" ")}
                    >
                      {format(d, "d")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" aria-hidden />
              {t("quickBook.slotLegendFree")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-600" aria-hidden />
              {t("quickBook.slotLegendBusy")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-800 ring-1 ring-zinc-600" aria-hidden />
              {t("quickBook.slotLegendPast")}
            </span>
          </p>

          <div className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {scheduleDisplaySlots.length === 0 ? (
              <p className="text-lg text-zinc-500">{t("quickBook.noSlotsThisDay")}</p>
            ) : (
              scheduleDisplaySlots.map((s) => {
                const sel = pickedStart?.getTime() === s.start.getTime();
                const isPast = s.start.getTime() < nowTick;
                const clickable = s.available && !isPast;
                const title = isPast
                  ? t("quickBook.slotPastTitle")
                  : !s.available
                    ? t("quickBook.slotBusyTitle")
                    : undefined;
                const cellClass = clickable
                  ? bigBtnClass(sel)
                  : [
                      "flex min-h-[56px] w-full flex-col items-center justify-center rounded-2xl border px-3 py-2 text-lg font-semibold transition",
                      isPast
                        ? "cursor-not-allowed border-zinc-800 bg-zinc-950/80 text-zinc-600 opacity-50"
                        : "cursor-not-allowed border-zinc-700/80 bg-zinc-900/60 text-zinc-500 opacity-80",
                    ].join(" ");
                return (
                  <button
                    key={s.start.toISOString()}
                    type="button"
                    disabled={!clickable}
                    title={title}
                    aria-disabled={!clickable}
                    onClick={() => {
                      if (clickable) setPickedStart(s.start);
                    }}
                    className={cellClass}
                  >
                    <span>{format(s.start, "HH:mm", { locale: undefined })}</span>
                    {!clickable && !isPast && (
                      <span className="mt-0.5 text-xs font-normal text-zinc-600">{t("quickBook.slotBusyShort")}</span>
                    )}
                    {isPast && (
                      <span className="mt-0.5 text-xs font-normal text-zinc-600">{t("quickBook.slotPastShort")}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            disabled={!pickedStart}
            onClick={() => push("client")}
            className={`${bigBtnClass(!!pickedStart)} ${!pickedStart ? "opacity-40" : ""}`}
          >
            {t("quickBook.continueClient")}
          </button>
        </div>
      )}

      {step === "client" && svc && (
        <div className="space-y-5">
          <h2 className="text-2xl font-semibold text-white">{t("quickBook.clientStep")}</h2>
          <input
            type="search"
            value={clientQuery}
            onChange={(e) => setClientQuery(e.target.value)}
            placeholder={t("quickBook.searchClient")}
            className="h-14 w-full rounded-2xl border border-white/15 bg-black/30 px-4 text-lg text-white placeholder:text-zinc-600"
          />
          {clientSearchLoading && <p className="text-sm text-zinc-500">{t("common.loading")}</p>}
          {clientHits.length > 0 && (
            <ul className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2">
              {clientHits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-base text-zinc-100 hover:bg-white/10"
                    onClick={() => {
                      setClientName(h.name);
                      setClientPhone(h.phone ?? "");
                      setClientQuery("");
                      setClientHits([]);
                    }}
                  >
                    {h.name}
                    {h.phone ? <span className="block text-sm text-zinc-500">{h.phone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="block">
            <span className="text-sm text-zinc-500">{t("modal.client")}</span>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="mt-1 h-14 w-full rounded-2xl border border-white/15 bg-black/30 px-4 text-lg text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-500">{t("modal.phone")}</span>
            <input
              inputMode="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              className="mt-1 h-14 w-full rounded-2xl border border-white/15 bg-black/30 px-4 text-lg text-white"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-500">{t("quickBook.comment")}</span>
            <textarea
              value={clientNote}
              onChange={(e) => setClientNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-lg text-white"
            />
          </label>
          <button type="button" onClick={() => push("confirm")} className={bigBtnClass()}>
            {t("quickBook.review")}
          </button>
        </div>
      )}

      {step === "confirm" && svc && pickedStart && (
        <div className="space-y-6 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-black/40 p-6 shadow-2xl backdrop-blur-xl">
          <h2 className="text-3xl font-bold text-white">{t("quickBook.confirmTitle")}</h2>
          <dl className="space-y-4 text-lg">
            <div>
              <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("modal.service")}</dt>
              <dd className="text-xl text-white">{svc.name}</dd>
            </div>
            <div>
              <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("modal.staff")}</dt>
              <dd className="text-xl text-white">{masterForConfirm?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("quickBook.when")}</dt>
              <dd className="text-xl text-white">
                {new Intl.DateTimeFormat(i18n.language, {
                  timeZone: SALON_TIME_ZONE,
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(pickedStart)}
              </dd>
            </div>
            <div>
              <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("quickBook.duration")}</dt>
              <dd className="text-xl text-white">
                {durationMin} {t("quickBook.min")}
              </dd>
            </div>
            <div>
              <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("modal.client")}</dt>
              <dd className="text-xl text-white">{clientName.trim() || "—"}</dd>
            </div>
            {svc.priceEur != null && (
              <div>
                <dt className="text-sm uppercase tracking-wide text-zinc-500">{t("quickBook.price")}</dt>
                <dd className="text-xl text-emerald-200">€{svc.priceEur}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={booking}
              onClick={() => void confirmBook()}
              className={`${bigBtnClass(true)} sm:flex-1`}
            >
              {booking ? t("common.loading") : t("quickBook.confirm")}
            </button>
            <button type="button" onClick={goBack} className={`${bigBtnClass()} sm:flex-1`}>
              {t("quickBook.back")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
