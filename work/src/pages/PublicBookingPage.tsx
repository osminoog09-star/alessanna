import { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { generateAvailableSlots, formatSlotRange } from "../lib/slots";
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

export function PublicBookingPage() {
  const { t, i18n } = useTranslation();
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [timeOff, setTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [dayStr, setDayStr] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

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
    let sv = await supabase
      .from("service_listings")
      .select("id,name,duration,buffer_after_min,is_active")
      .order("name");
    if (sv.error) {
      sv = await supabase.from("service_listings").select("id,name,duration,is_active").order("name");
      if (sv.error) {
        sv = await supabase.from("service_listings").select("id,name,duration,buffer_after_min").order("name");
      }
      if (sv.error) {
        sv = await supabase.from("service_listings").select("id,name,duration").order("name");
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

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured() || !staffId) return;
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .eq("staff_id", staffId)
        .gte("start_time", start.toISOString())
        .lte("start_time", end.toISOString())
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .eq("staff_id", staffId)
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
  }, [day, staffId]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  const eligibleStaff = useMemo(() => {
    if (serviceId == null) return [];
    const base = staffEligibleForService(staff, links, serviceId);
    return applyPublicStaffVisibility(base, links, serviceId);
  }, [staff, links, serviceId]);

  const svc = services.find((s) => s.id === serviceId);
  const durationMin = svc ? svc.duration_min + svc.buffer_after_min : 60;

  const staffScheduleForGen = useMemo(() => {
    if (!staffId) return [];
    return schedules
      .filter((s) => s.staff_id === staffId)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
      }));
  }, [schedules, staffId]);

  const slots = useMemo(() => {
    if (!staffId || !svc) return [];
    return generateAvailableSlots({
      schedule: staffScheduleForGen,
      appointments,
      timeOff,
      duration: durationMin,
      day,
      stepMinutes: 15,
      staffId,
    });
  }, [staffId, svc, staffScheduleForGen, appointments, timeOff, durationMin, day]);

  async function confirmBook() {
    if (!svc || !staffId || !pickedStart || !clientName.trim()) {
      setMsg(t("publicBook.fillAll"));
      return;
    }
    setBooking(true);
    setMsg(null);
    const end = new Date(pickedStart.getTime() + durationMin * 60 * 1000);
    const { error } = await supabase.from("appointments").insert({
      staff_id: staffId,
      service_id: svc.id,
      client_name: clientName.trim(),
      client_phone: clientPhone.trim() || null,
      start_time: pickedStart.toISOString(),
      end_time: end.toISOString(),
      status: "confirmed",
      source: "online",
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
                setStaffId(null);
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

          {staffId && (
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start.toISOString()}
                      type="button"
                      onClick={() => setPickedStart(s.start)}
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
