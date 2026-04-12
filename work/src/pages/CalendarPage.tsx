import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addDays, format, startOfDay, startOfWeek, endOfWeek } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useCalendarDataRealtime } from "../hooks/useSalonRealtime";
import { useAuth } from "../context/AuthContext";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import type { ServiceRow, StaffMember, StaffScheduleRow, StaffServiceRow, StaffTimeOffRow } from "../types/database";
import {
  mapAppointmentServiceRowsToBlocks,
  type CalendarServiceBlock,
  type SupabaseAppointmentServiceJoinRow,
} from "../lib/calendarBlocks";
import { normalizeStaffMember } from "../lib/roles";
import { effectiveCanWorkCalendar } from "../lib/effectiveRole";
import { BookingModal } from "../components/BookingModal";
import { BlockTimeModal } from "../components/BlockTimeModal";
import { SalonTimelineGrid } from "../components/calendar/SalonTimelineGrid";
import type { AppOutletContext } from "../types/appOutlet";

type View = "day" | "week";

const GRID_START = 9;
const GRID_END = 21;

const APPOINTMENT_LINES_SELECT = `
  id, appointment_id, staff_id, service_id, start_time, end_time,
  appointments ( id, status, client_name, client_phone ),
  services ( id, name_et ),
  staff ( id, name )
`;

export function CalendarPage() {
  const { t } = useTranslation();
  const { staffMember, isReceptionMode } = useAuth();
  const { canManage, isWorkerOnlyEffective } = useEffectiveRole();
  const { setCalendarStaffBar } = useOutletContext<Partial<AppOutletContext>>() ?? {};
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [staffId, setStaffId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOffRow[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarServiceBlock[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<StaffServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingModal, setBookingModal] = useState<{ start: Date; staffId: string } | null>(null);
  const [blockModal, setBlockModal] = useState<{ start: Date; staffId: string } | null>(null);

  const load = useCallback(async () => {
    let lineQuery = supabase.from("appointment_services").select(APPOINTMENT_LINES_SELECT);
    if (isWorkerOnlyEffective && staffMember) {
      lineQuery = lineQuery.eq("staff_id", staffMember.id);
    }
    const [st, sch, to, lines, sv, ss] = await Promise.all([
      supabase.from("staff").select("*").order("name"),
      supabase.from("staff_schedule").select("*"),
      supabase.from("staff_time_off").select("*"),
      lineQuery,
      supabase.from("services").select("*").eq("active", true),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.data) {
      setStaff((st.data as Record<string, unknown>[]).map((r) => normalizeStaffMember(r as StaffMember)));
    }
    if (sch.data) setSchedules(sch.data as StaffScheduleRow[]);
    if (to.data) setTimeOff(to.data as StaffTimeOffRow[]);
    if (lines.data) {
      setCalendarBlocks(mapAppointmentServiceRowsToBlocks(lines.data as SupabaseAppointmentServiceJoinRow[]));
    }
    if (ss.data) setStaffServiceLinks(ss.data as StaffServiceRow[]);
    if (sv.data) setServices(sv.data as ServiceRow[]);
    setLoading(false);
  }, [isWorkerOnlyEffective, staffMember]);

  useEffect(() => {
    void load();
  }, [load]);

  useCalendarDataRealtime(load);

  const rosterStaff = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      const self = staff.find((e) => e.id === staffMember.id);
      return self ? [self] : [];
    }
    return [...staff].filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, staffMember, isWorkerOnlyEffective]);

  useEffect(() => {
    if (!rosterStaff.length) return;
    if (isWorkerOnlyEffective && staffMember) {
      setStaffId(staffMember.id);
      return;
    }
    if (staffId == null || !rosterStaff.some((e) => e.id === staffId)) {
      setStaffId(rosterStaff[0].id);
    }
  }, [rosterStaff, staffId, staffMember, isWorkerOnlyEffective]);

  useEffect(() => {
    if (!setCalendarStaffBar) return;
    if (staffId == null || rosterStaff.length < 2) {
      setCalendarStaffBar(null);
      return;
    }
    setCalendarStaffBar({
      value: staffId,
      onChange: (id) => setStaffId(id),
      options: rosterStaff.map((e) => ({ id: e.id, name: e.name })),
    });
    return () => setCalendarStaffBar(null);
  }, [staffId, rosterStaff, setCalendarStaffBar]);

  const canUseCalendar =
    isReceptionMode || (staffMember != null && effectiveCanWorkCalendar(staffMember.roles));

  const canBlockTime =
    !isReceptionMode && staffMember != null && effectiveCanWorkCalendar(staffMember.roles);

  const filteredBlocks = useMemo(() => {
    if (isWorkerOnlyEffective && staffMember) {
      return calendarBlocks.filter((b) => b.staff_id === staffMember.id);
    }
    return calendarBlocks;
  }, [calendarBlocks, staffMember, isWorkerOnlyEffective]);

  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
  const days =
    view === "day" ? [startOfDay(cursor)] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const cancelAppointment = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
      if (error) {
        window.alert(t("auth.error.rpcFailed", { message: error.message }));
        return;
      }
      void load();
    },
    [load, t]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("calendar.title")}</h1>
          <p className="text-sm text-zinc-500">{t("calendar.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 p-0.5">
            <button
              type="button"
              onClick={() => setView("day")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "day" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t("calendar.day")}
            </button>
            <button
              type="button"
              onClick={() => setView("week")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                view === "week" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t("calendar.week")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCursor(addDays(cursor, view === "day" ? -1 : -7))}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            {t("calendar.today")}
          </button>
          <button
            type="button"
            onClick={() => setCursor(addDays(cursor, view === "day" ? 1 : 7))}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            →
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        {rosterStaff.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("calendar.staff")}
            <select
              value={staffId ?? ""}
              onChange={(e) => setStaffId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            >
              {rosterStaff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="text-sm text-zinc-600">
          {view === "week"
            ? `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`
            : format(cursor, "EEEE d MMMM yyyy")}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-600/80 ring-1 ring-sky-500/50" />
            {t("salonCalendar.legendAppointments")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-800/90 ring-1 ring-red-500/40" />
            {t("salonCalendar.legendBlocked")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-zinc-700 bg-zinc-900" />
            {t("salonCalendar.legendFree")}
          </span>
        </div>
      </div>

      {loading || staffId == null ? (
        <p className="text-zinc-500">{t("common.loading")}</p>
      ) : view === "day" ? (
        <SalonTimelineGrid
          day={startOfDay(cursor)}
          staffId={staffId}
          blocks={filteredBlocks}
          services={services}
          schedules={schedules}
          timeOff={timeOff}
          startHour={GRID_START}
          endHour={GRID_END}
          onEmptyClick={(start, sid) => setBookingModal({ start, staffId: sid })}
          onBlockTime={(start, sid) => setBlockModal({ start, staffId: sid })}
          canCreate={canUseCalendar}
          canBlockTime={canBlockTime}
          canDeleteAppointments={canManage || isReceptionMode}
          onCancelVisit={cancelAppointment}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-7">
          {days.map((day) => (
            <SalonTimelineGrid
              key={day.toISOString()}
              day={day}
              staffId={staffId}
              blocks={filteredBlocks}
              services={services}
              schedules={schedules}
              timeOff={timeOff}
              startHour={GRID_START}
              endHour={GRID_END}
              compact
              onEmptyClick={(start, sid) => setBookingModal({ start, staffId: sid })}
              onBlockTime={(start, sid) => setBlockModal({ start, staffId: sid })}
              canCreate={canUseCalendar}
              canBlockTime={canBlockTime}
              canDeleteAppointments={canManage || isReceptionMode}
              onCancelVisit={cancelAppointment}
            />
          ))}
        </div>
      )}

      {bookingModal && (
        <BookingModal
          open
          variant="pro"
          onClose={() => setBookingModal(null)}
          onSaved={load}
          initialStart={bookingModal.start}
          initialStaffId={bookingModal.staffId}
          staffList={staff}
          services={services}
          links={staffServiceLinks}
          lockStaff={isWorkerOnlyEffective}
          schedules={schedules}
          timeOffRows={timeOff}
        />
      )}

      {blockModal && (
        <BlockTimeModal
          open
          onClose={() => setBlockModal(null)}
          onSaved={load}
          initialStart={blockModal.start}
          initialStaffId={blockModal.staffId}
          staffList={staff}
          lockStaff={isWorkerOnlyEffective}
          busyLines={filteredBlocks}
          timeOffRows={timeOff}
        />
      )}
    </div>
  );
}
