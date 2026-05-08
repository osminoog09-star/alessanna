import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { generateAvailableSlots, formatSlotRange, type Slot } from "../lib/slots";
import {
  applyPublicStaffVisibility,
  isStaffRowAdmin,
  isStaffShownOnPublicMarketing,
  normalizeStaffMember,
  staffEligibleForService,
} from "../lib/roles";
import type { AppointmentRow, StaffMember, StaffScheduleRow, StaffServiceRow } from "../types/database";

type PublicService = {
  id: string;
  name: string;
  duration_min: number;
  buffer_after_min: number;
  active: boolean;
};

const ANY_MASTER_ID = "any";

export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentRow[]>([]);
  const [timeOff, setTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(ANY_MASTER_ID);
  const [dayStr, setDayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const isReceptionMode = location.pathname === "/reception";

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [st, lk, sc] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
    ]);
    /* Fallback по `select(...)`: каждая ветка возвращает свой shape, поэтому
     * для TS ниже всегда `as typeof sv`. На рантайме всё равно нормализуем. */
    let sv = await supabase
      .from("service_listings")
      .select("id,name,duration,buffer_after_min,is_active")
      .order("name");
    if (sv.error) {
      sv = (await supabase
        .from("service_listings")
        .select("id,name,duration,is_active")
        .order("name")) as typeof sv;
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration,buffer_after_min")
          .order("name")) as typeof sv;
      }
      if (sv.error) {
        sv = (await supabase
          .from("service_listings")
          .select("id,name,duration")
          .order("name")) as typeof sv;
      }
    }
    if (sv.data) {
      setServices(
        (sv.data as Array<{ id: string; name: string; duration?: number; buffer_after_min?: number; is_active?: boolean }>).map((s) => ({
          id: String(s.id),
          name: String(s.name || "").trim(),
          duration_min: Number(s.duration || 0),
          buffer_after_min: Number(s.buffer_after_min || 10),
          active: s.is_active !== false,
        }))
      );
    }
    if (st.data) {
      setStaff(
        (st.data as Record<string, unknown>[])
          .filter((row) => !isStaffRowAdmin(row))
          .map((r) => normalizeStaffMember(r as StaffMember))
          .filter((m) => isStaffShownOnPublicMarketing(m))
      );
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    if (sc.data) setSchedules(sc.data as StaffScheduleRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const day = useMemo(() => startOfDay(new Date(dayStr + "T12:00:00")), [dayStr]);

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of services) map.set(String(s.id), s.name);
    return map;
  }, [services]);

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staff) map.set(String(s.id), s.name);
    return map;
  }, [staff]);

  const eligibleStaff = useMemo(() => {
    if (serviceId == null) return [];
    const base = staffEligibleForService(staff, links, serviceId);
    return applyPublicStaffVisibility(base, links, serviceId);
  }, [staff, links, serviceId]);

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured() || serviceId == null) return;
    const eligibleIds = eligibleStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setAppointments([]);
      setTimeOff([]);
      return;
    }
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", start.toISOString())
        .lte("start_time", end.toISOString())
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", eligibleIds)
        .lte("start_time", end.toISOString())
        .gte("end_time", start.toISOString()),
    ]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (to.data) {
      setTimeOff(
        (to.data as { staff_id: string; start_time: string; end_time: string }[]).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        }))
      );
    }
  }, [day, eligibleStaff, serviceId]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  const loadUpcomingData = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from("appointments")
      .select("*")
      .gte("start_time", nowIso)
      .neq("status", "cancelled")
      .order("start_time", { ascending: true })
      .limit(120);
    if (data) setUpcomingAppointments(data as AppointmentRow[]);
  }, []);

  useEffect(() => {
    void loadUpcomingData();
  }, [loadUpcomingData]);

  const svc = services.find((s) => s.id === serviceId);
  const durationMin = svc ? svc.duration_min + svc.buffer_after_min : 60;

  const slotsByStaff = useMemo(() => {
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
      const slots = generateAvailableSlots({
        schedule: memberSchedule,
        appointments,
        timeOff,
        duration: durationMin,
        day,
        stepMinutes: 15,
        staffId: member.id,
      });
      out.set(member.id, slots);
    }
    return out;
  }, [appointments, day, durationMin, eligibleStaff, schedules, svc, timeOff]);

  const slotCoverage = useMemo(() => {
    const coverage = new Map<string, number>();
    for (const slots of slotsByStaff.values()) {
      for (const s of slots) {
        const key = s.start.toISOString();
        coverage.set(key, (coverage.get(key) || 0) + 1);
      }
    }
    return coverage;
  }, [slotsByStaff]);

  const slots = useMemo(() => {
    if (!svc) return [];
    if (staffId && staffId !== ANY_MASTER_ID) {
      return slotsByStaff.get(staffId) || [];
    }
    const byStart = new Map<string, Slot>();
    for (const staffSlots of slotsByStaff.values()) {
      for (const s of staffSlots) {
        const key = s.start.toISOString();
        if (!byStart.has(key)) byStart.set(key, s);
      }
    }
    return Array.from(byStart.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [slotsByStaff, staffId, svc]);

  const receptionUpcoming = useMemo(() => {
    const allowedStaffIds = new Set(staff.map((s) => s.id));
    const base = upcomingAppointments.filter((a) => allowedStaffIds.has(a.staff_id));
    const relevant = staffId ? base.filter((a) => a.staff_id === staffId) : base;
    return relevant.slice(0, 8);
  }, [upcomingAppointments, staff, staffId]);

  const nearestByMaster = useMemo(() => {
    const out = new Map<string, AppointmentRow>();
    for (const row of upcomingAppointments) {
      if (!staffNameById.has(row.staff_id)) continue;
      if (!out.has(row.staff_id)) out.set(row.staff_id, row);
    }
    return Array.from(out.entries())
      .map(([sid, ap]) => ({ staffId: sid, appointment: ap }))
      .sort((a, b) => {
        const ta = new Date(a.appointment.start_time || "").getTime();
        const tb = new Date(b.appointment.start_time || "").getTime();
        return ta - tb;
      })
      .slice(0, 6);
  }, [upcomingAppointments, staffNameById]);

  async function confirmBook() {
    if (!svc || !pickedStart || !clientName.trim()) {
      setMsg(t("publicBook.fillAll"));
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
      setMsg("На выбранное время нет свободного мастера. Выберите другое время.");
      return;
    }
    const end = new Date(pickedStart.getTime() + durationMin * 60 * 1000);
    /* Колонок `source`/`notes` нет в актуальной схеме `appointments`. Отправляем
     *  только реально существующие — иначе PostgREST вернёт ошибку schema cache. */
    const { error } = await supabase.from("appointments").insert({
      staff_id: finalStaffId,
      service_id: svc.id,
      client_name: clientName.trim(),
      client_phone: clientPhone.trim() || null,
      start_time: pickedStart.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
    });
    setBooking(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg(t("publicBook.success"));
    setPickedStart(null);
    setClientName("");
    setClientPhone("");
    void loadDayData();
    void loadUpcomingData();
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
        <p className="mt-1 text-sm text-zinc-500">
          {isReceptionMode
            ? "Режим ресепшен: быстрая запись клиента без входа в CRM."
            : t("publicBook.subtitle")}
        </p>
        <Link to="/login" className="mt-2 inline-block text-sm text-sky-400">
          {t("publicBook.staffLogin")}
        </Link>

        <div className="mt-8 space-y-6">
          <label className="block text-sm">
            <span className="text-zinc-400">{t("modal.service")}</span>
            <select
              value={serviceId ?? ""}
              onChange={(e) => {
                setServiceId(e.target.value ? String(e.target.value) : null);
                setStaffId(ANY_MASTER_ID);
                setPickedStart(null);
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
            >
              <option value="">{t("modal.pickService")}</option>
              {services.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {serviceId != null && (
            <label className="block text-sm">
              <span className="text-zinc-400">{t("modal.staff")}</span>
              <select
                value={staffId ?? ""}
                onChange={(e) => {
                  setStaffId(e.target.value || null);
                  setPickedStart(null);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
              >
                <option value="">{t("publicBook.pickStaff")}</option>
                {eligibleStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {serviceId != null && (
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
          )}

          {isReceptionMode && (
            <section className="rounded-xl border border-zinc-800 bg-black/30 p-4">
              <h2 className="text-sm font-semibold text-white">Ближайшие работы</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {staffId
                  ? "Показаны ближайшие записи выбранного мастера."
                  : "Показаны ближайшие записи по всем мастерам. Выберите мастера, чтобы сузить список."}
              </p>

              <div className="mt-3 space-y-2">
                {receptionUpcoming.length > 0 ? (
                  receptionUpcoming.map((ap) => (
                    <div
                      key={ap.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300"
                    >
                      <div className="font-medium text-zinc-100">
                        {ap.start_time
                          ? new Date(ap.start_time).toLocaleString(i18n.language, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </div>
                      <div className="mt-0.5 text-zinc-400">
                        {staffNameById.get(ap.staff_id) || "—"} · {serviceNameById.get(String(ap.service_id)) || "—"}
                      </div>
                      <div className="mt-0.5 text-zinc-500">{ap.client_name || "—"}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-zinc-600">Ближайших записей пока нет.</p>
                )}
              </div>

              {!staffId && nearestByMaster.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-400">Следующая запись по мастерам</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {nearestByMaster.map(({ staffId: sid, appointment }) => (
                      <button
                        key={sid}
                        type="button"
                        onClick={() => setStaffId(sid)}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-sky-700/70 hover:text-white"
                      >
                        <div className="font-medium text-zinc-100">{staffNameById.get(sid) || "—"}</div>
                        <div className="mt-0.5 text-zinc-500">
                          {appointment.start_time
                            ? new Date(appointment.start_time).toLocaleString(i18n.language, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "—"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {serviceId != null && (
            <>
              <label className="block text-sm">
                <span className="text-zinc-400">Мастер (по желанию)</span>
                <select
                  value={staffId ?? ANY_MASTER_ID}
                  onChange={(e) => {
                    setStaffId(e.target.value || ANY_MASTER_ID);
                    setPickedStart(null);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
                >
                  <option value={ANY_MASTER_ID}>Любой свободный мастер</option>
                  {eligibleStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="text-sm text-zinc-400">{t("publicBook.slots")}</p>
                {staffId === ANY_MASTER_ID && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Показаны слоты, где есть хотя бы один свободный мастер.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => {
                    const key = s.start.toISOString();
                    const freeCount = slotCoverage.get(key) || 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPickedStart(s.start)}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          pickedStart?.getTime() === s.start.getTime()
                            ? "border-sky-500 bg-sky-950/50 text-white"
                            : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                        }`}
                      >
                        {formatSlotRange(s)}
                        {staffId === ANY_MASTER_ID && freeCount > 0 ? ` · свободно: ${freeCount}` : ""}
                      </button>
                    );
                  })}
                </div>
                {slots.length === 0 && <p className="mt-2 text-xs text-zinc-600">{t("publicBook.noSlots")}</p>}
              </div>

              {pickedStart && (
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-black/40 p-4">
                  <p className="text-sm text-zinc-400">
                    {pickedStart.toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
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
                  <button
                    type="button"
                    disabled={booking}
                    onClick={() => void confirmBook()}
                    className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t("publicBook.confirm")}
                  </button>
                </div>
              )}
            </>
          )}

          {msg && <p className="text-sm text-emerald-400/90">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
