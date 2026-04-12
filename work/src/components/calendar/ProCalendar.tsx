import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { addMinutes, isSameDay, parseISO, setHours, setMinutes, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import type { StaffMember, StaffScheduleRow, StaffServiceRow, ServiceListingRow } from "../../types/database";

/** One `appointment_services` line (id = service line row, not visit header). */
type ProCalendarBooking = {
  id: string;
  staff_id: string;
  service_id: string;
  client_name: string;
  start_time: string;
  end_time: string;
};
import { staffCanPerformService } from "../../lib/roles";
import { appointmentInterval, intervalsOverlap, workingWindowsForWeekday } from "../../lib/slots";
import type { StaffTimeOffRow } from "../../types/database";
import { useIsMobile } from "../../hooks/useIsMobile";

const SLOT_PREFIX = "slot-";
const BOOKING_PREFIX = "booking-";

function slotId(staffId: string, hour: number) {
  return `${SLOT_PREFIX}${staffId}|${hour}`;
}

function parseSlotId(id: string): { staffId: string; hour: number } | null {
  if (!id.startsWith(SLOT_PREFIX)) return null;
  const rest = id.slice(SLOT_PREFIX.length);
  const pipe = rest.lastIndexOf("|");
  if (pipe <= 0) return null;
  const sid = rest.slice(0, pipe);
  const hour = Number(rest.slice(pipe + 1));
  if (!Number.isFinite(hour)) return null;
  return { staffId: sid, hour };
}

type StaffColumn = Pick<StaffMember, "id" | "name">;

function hourInWorkingWindow(weekday: number, hour: number, schedules: StaffScheduleRow[], staffId: string): boolean {
  const mine = schedules.filter((s) => s.staff_id === staffId);
  const windows = workingWindowsForWeekday(
    mine.map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time })),
    weekday
  );
  const hStart = hour * 60;
  const hEnd = (hour + 1) * 60;
  return windows.some((w) => hStart < w.end && hEnd > w.start);
}

function hourInTimeOff(day: Date, hour: number, staffId: string, timeOff: StaffTimeOffRow[]): boolean {
  const slotStart = setMinutes(setHours(startOfDay(day), hour), 0);
  const slotEnd = addMinutes(slotStart, 60);
  for (const t of timeOff) {
    if (t.staff_id !== staffId) continue;
    try {
      const a = parseISO(t.start_time);
      const b = parseISO(t.end_time);
      if (intervalsOverlap(slotStart, slotEnd, a, b)) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

type ProCalendarProps = {
  day: Date;
  appointments: ProCalendarBooking[];
  staff: StaffMember[];
  services: ServiceListingRow[];
  staffServiceLinks?: StaffServiceRow[];
  schedules: StaffScheduleRow[];
  timeOff: StaffTimeOffRow[];
  startHour?: number;
  endHour?: number;
  onRefresh: () => void;
  onEmptyClick: (start: Date, staffId: string) => void;
  canCreate: boolean;
  canDrag: boolean;
  lockToStaffId?: string | null;
};

const DroppableHourCell = memo(function DroppableHourCell({
  staffId,
  hour,
  day,
  hasBooking,
  isMobile,
  children,
  onEmptyClick,
  canCreate,
  emptySlotAriaLabel,
  workingBg,
  timeOffBg,
}: {
  staffId: string;
  hour: number;
  day: Date;
  hasBooking: boolean;
  isMobile: boolean;
  children: ReactNode;
  onEmptyClick?: () => void;
  canCreate: boolean;
  emptySlotAriaLabel: string;
  workingBg: boolean;
  timeOffBg: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId(staffId, hour),
    data: { staffId, hour },
  });

  const hCell = isMobile ? "min-h-[5.5rem]" : "h-20";
  const bg =
    timeOffBg && !hasBooking
      ? "bg-red-950/35"
      : workingBg && !hasBooking
        ? "bg-sky-950/20"
        : "";

  return (
    <div
      ref={setNodeRef}
      className={`relative border-b border-white/[0.06] ${hCell} ${bg} ${
        isOver ? "bg-sky-500/10 shadow-[inset_0_0_20px_rgba(56,189,248,0.12)]" : ""
      }`}
    >
      {!hasBooking && canCreate && onEmptyClick && (
        <button
          type="button"
          aria-label={emptySlotAriaLabel}
          className={`group absolute inset-0 z-0 flex cursor-pointer touch-manipulation items-center justify-center rounded-lg border border-transparent transition active:bg-sky-500/15 ${
            isMobile ? "min-h-[5.25rem]" : ""
          } hover:border-sky-500/25 hover:bg-sky-500/[0.07]`}
          onClick={onEmptyClick}
        >
          <span className="pointer-events-none text-xs font-medium text-zinc-600 opacity-70 group-hover:text-sky-200/80 group-hover:opacity-100 md:text-[10px]">
            +
          </span>
        </button>
      )}
      <div className="relative z-[2] flex h-full min-h-0 items-stretch p-1">{children}</div>
    </div>
  );
});

const DraggableBooking = memo(function DraggableBooking({
  booking,
  serviceName,
  disabled,
  isMobile,
}: {
  booking: ProCalendarBooking;
  serviceName: string;
  disabled: boolean;
  isMobile: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${BOOKING_PREFIX}${booking.id}`,
    disabled,
    data: { bookingId: booking.id },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`z-[2] w-full rounded-xl border border-sky-400/40 bg-gradient-to-br from-sky-600/30 via-sky-500/15 to-transparent p-2 shadow-[0_4px_24px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:scale-[1.02] md:touch-none ${
        isMobile ? "min-h-[4.5rem] touch-manipulation p-3 text-base" : "touch-manipulation text-xs"
      } ${isDragging ? "cursor-grabbing opacity-60 ring-2 ring-sky-400/50" : "cursor-grab"}`}
    >
      <div className={`font-semibold text-sky-50 ${isMobile ? "text-sm" : ""}`}>{booking.client_name}</div>
      <div className={`text-zinc-400 ${isMobile ? "text-sm" : "text-[11px]"}`}>{serviceName}</div>
    </div>
  );
});

export function ProCalendar({
  day,
  appointments,
  staff,
  services,
  staffServiceLinks = [],
  schedules,
  timeOff,
  startHour = 9,
  endHour = 18,
  onRefresh,
  onEmptyClick,
  canCreate,
  canDrag,
  lockToStaffId,
}: ProCalendarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile(768);
  const [staffFilter, setStaffFilter] = useState<string | "all">("all");
  const [mobileTab, setMobileTab] = useState<"day" | "team">("day");
  const [mobileFocusId, setMobileFocusId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ProCalendarBooking | null>(null);

  const weekday = day.getDay();

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  );

  const activeList = useMemo(
    () => staff.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );

  useEffect(() => {
    if (lockToStaffId != null) {
      setStaffFilter(lockToStaffId);
      setMobileFocusId(lockToStaffId);
      return;
    }
    if (mobileFocusId == null && activeList[0]) {
      setMobileFocusId(activeList[0].id);
    }
  }, [lockToStaffId, activeList, mobileFocusId]);

  const filteredColumns: StaffColumn[] = useMemo(() => {
    if (lockToStaffId != null) {
      const one = activeList.find((e) => e.id === lockToStaffId);
      return one ? [{ id: one.id, name: one.name }] : [];
    }
    if (isMobile) {
      if (staffFilter === "all") {
        const fid = mobileFocusId ?? activeList[0]?.id;
        const em = activeList.find((e) => e.id === fid);
        return em ? [{ id: em.id, name: em.name }] : [];
      }
      const em = activeList.find((e) => e.id === staffFilter);
      return em ? [{ id: em.id, name: em.name }] : [];
    }
    if (staffFilter === "all") {
      return activeList.map((e) => ({ id: e.id, name: e.name }));
    }
    const em = activeList.find((e) => e.id === staffFilter);
    return em ? [{ id: em.id, name: em.name }] : [];
  }, [activeList, staffFilter, isMobile, mobileFocusId, lockToStaffId]);

  const dayAppointments = useMemo(() => {
    return appointments.filter((b) => {
      try {
        return isSameDay(parseISO(b.start_time), day);
      } catch {
        return false;
      }
    });
  }, [appointments, day]);

  const bookingAt = useCallback(
    (sid: string, hour: number): ProCalendarBooking | undefined => {
      return dayAppointments.find((b) => {
        if (b.staff_id !== sid) return false;
        const iv = appointmentInterval(b);
        if (!iv) return false;
        return iv.start.getHours() === hour;
      });
    },
    [dayAppointments]
  );

  const serviceName = useCallback(
    (serviceId: string) => services.find((s) => s.id === serviceId)?.name ?? t("common.service"),
    [services, t]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: isMobile ? 12 : 8 },
    })
  );

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const id = String(e.active.id);
      if (!id.startsWith(BOOKING_PREFIX)) return;
      const bid = id.slice(BOOKING_PREFIX.length);
      const b = dayAppointments.find((x) => String(x.id) === bid);
      setActiveDrag(b ?? null);
    },
    [dayAppointments]
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      if (!activeId.startsWith(BOOKING_PREFIX)) return;
      const bookingId = activeId.slice(BOOKING_PREFIX.length);

      const parsed = parseSlotId(String(over.id));
      if (!parsed) return;

      const booking = appointments.find((b) => String(b.id) === bookingId);
      if (!booking) return;

      if (lockToStaffId != null && parsed.staffId !== lockToStaffId) return;

      if (!staffCanPerformService(staffServiceLinks, parsed.staffId, booking.service_id, staff)) {
        return;
      }

      const svc = services.find((s) => s.id === booking.service_id);
      const duration = svc
        ? Math.max(1, svc.duration ?? 60) + Math.max(0, svc.buffer_after_min ?? 0)
        : 70;
      const slotStart = setMinutes(setHours(startOfDay(day), parsed.hour), 0);
      const slotEnd = addMinutes(slotStart, duration);

      const clash = dayAppointments.some((b) => {
        if (String(b.id) === bookingId || b.staff_id !== parsed.staffId) return false;
        const iv = appointmentInterval(b);
        if (!iv) return false;
        return intervalsOverlap(slotStart, slotEnd, iv.start, iv.end);
      });
      if (clash) return;

      const { error } = await supabase
        .from("appointment_services")
        .update({
          staff_id: parsed.staffId,
          start_time: slotStart.toISOString(),
          end_time: slotEnd.toISOString(),
        })
        .eq("id", bookingId);

      if (!error) onRefresh();
    },
    [appointments, day, dayAppointments, staffServiceLinks, staff, lockToStaffId, onRefresh, services]
  );

  const openCreate = useCallback(
    (hour: number, sid: string) => {
      const start = setMinutes(setHours(startOfDay(day), hour), 0);
      onEmptyClick(start, sid);
    },
    [day, onEmptyClick]
  );

  const showFilter = lockToStaffId == null;

  return (
    <div className="space-y-4">
      {isMobile && showFilter && (
        <div className="flex gap-2 rounded-xl border border-white/[0.08] bg-black/40 p-1 backdrop-blur-sm md:hidden">
          <button
            type="button"
            onClick={() => setMobileTab("day")}
            className={`flex-1 rounded-lg py-3 text-sm font-semibold touch-manipulation transition ${
              mobileTab === "day"
                ? "bg-sky-500/20 text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.15)]"
                : "text-zinc-500"
            }`}
          >
            {t("proCalendar.dayTab")}
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("team")}
            className={`flex-1 rounded-lg py-3 text-sm font-semibold touch-manipulation transition ${
              mobileTab === "team"
                ? "bg-sky-500/20 text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.15)]"
                : "text-zinc-500"
            }`}
          >
            {t("proCalendar.teamTab")}
          </button>
        </div>
      )}

      {isMobile && showFilter && mobileTab === "team" && (
        <div className="flex gap-2 overflow-x-auto pb-2 md:hidden [-webkit-overflow-scrolling:touch]">
          <button
            type="button"
            onClick={() => {
              setStaffFilter("all");
              setMobileTab("day");
            }}
            className={`shrink-0 rounded-full border px-5 py-3 text-sm font-medium touch-manipulation ${
              staffFilter === "all"
                ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                : "border-white/10 bg-white/[0.04] text-zinc-300"
            }`}
          >
            {t("proCalendar.all")}
          </button>
          {activeList.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setStaffFilter("all");
                setMobileFocusId(e.id);
                setMobileTab("day");
              }}
              className={`shrink-0 rounded-full border px-5 py-3 text-sm font-medium touch-manipulation ${
                mobileFocusId === e.id && staffFilter === "all"
                  ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                  : "border-white/10 bg-white/[0.04] text-zinc-300"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
      )}

      {showFilter && (!isMobile || mobileTab === "day") && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {t("proCalendar.staffFilter")}
            </span>
            <select
              value={staffFilter === "all" ? "all" : staffFilter}
              onChange={(e) => {
                const v = e.target.value;
                setStaffFilter(v === "all" ? "all" : v);
              }}
              className="min-w-[12rem] rounded-xl border border-white/10 bg-zinc-950/80 px-4 py-2.5 text-sm text-white shadow-inner backdrop-blur-md focus:border-sky-500/40 focus:outline-none focus:ring-1 focus:ring-sky-500/30"
            >
              <option value="all">{t("proCalendar.allStaff")}</option>
              {activeList.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-center text-xs text-zinc-600 md:text-left">{t("proCalendar.hint")}</p>
        </div>
      )}

      {(!isMobile || mobileTab === "day") && filteredColumns.length === 0 && (
        <p className="text-sm text-zinc-500">{t("proCalendar.noStaff")}</p>
      )}

      {(!isMobile || mobileTab === "day") && filteredColumns.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,0.65)] [-webkit-overflow-scrolling:touch]">
            <div className="flex min-w-max">
              <div
                className={`sticky left-0 z-10 w-14 shrink-0 border-r border-white/[0.08] bg-[#050506]/95 backdrop-blur-md sm:w-20 ${
                  isMobile ? "pt-[4.25rem]" : "pt-16"
                }`}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className={`flex items-start justify-end pr-2 text-zinc-500 ${
                      isMobile ? "min-h-[5.5rem] text-sm" : "h-20 text-sm"
                    }`}
                  >
                    {h}:00
                  </div>
                ))}
              </div>

              {filteredColumns.map((staffCol) => (
                <div
                  key={staffCol.id}
                  className={`shrink-0 border-r border-white/[0.06] last:border-r-0 ${
                    isMobile ? "min-w-[min(100vw-4rem,320px)]" : "min-w-[160px] flex-1"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center border-b border-white/[0.08] font-medium text-zinc-200 ${
                      isMobile ? "min-h-[4.25rem] text-base" : "h-16 text-sm"
                    }`}
                  >
                    {staffCol.name}
                  </div>
                  {hours.map((h) => {
                    const b = bookingAt(staffCol.id, h);
                    const workingBg = hourInWorkingWindow(weekday, h, schedules, staffCol.id);
                    const timeOffBg = hourInTimeOff(day, h, staffCol.id, timeOff);
                    return (
                      <DroppableHourCell
                        key={h}
                        staffId={staffCol.id}
                        hour={h}
                        day={day}
                        hasBooking={!!b}
                        isMobile={isMobile}
                        canCreate={canCreate}
                        workingBg={workingBg}
                        timeOffBg={timeOffBg}
                        onEmptyClick={!b && canCreate ? () => openCreate(h, staffCol.id) : undefined}
                        emptySlotAriaLabel={t("proCalendar.createBookingAria", { hour: h })}
                      >
                        {b && (
                          <DraggableBooking
                            booking={b}
                            serviceName={serviceName(b.service_id)}
                            disabled={!canDrag}
                            isMobile={isMobile}
                          />
                        )}
                      </DroppableHourCell>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDrag ? (
              <div
                className={`pointer-events-none rounded-xl border border-sky-400/40 bg-gradient-to-br from-sky-600/35 to-sky-900/20 p-3 shadow-2xl backdrop-blur-md ${
                  isMobile ? "min-w-[240px] text-base" : "w-36 text-xs"
                }`}
              >
                <div className="font-semibold text-sky-50">{activeDrag.client_name}</div>
                <div className="text-zinc-400">{serviceName(activeDrag.service_id)}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
