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
import type { BookingRow, EmployeeRow, EmployeeServiceRow, ServiceRow } from "../../types/database";
import { employeeCanPerformService } from "../../lib/roles";
import { bookingInterval, intervalsOverlap } from "../../lib/slots";
import { useIsMobile } from "../../hooks/useIsMobile";

const SLOT_PREFIX = "slot-";
const BOOKING_PREFIX = "booking-";

function slotId(employeeId: number, hour: number) {
  return `${SLOT_PREFIX}${employeeId}-${hour}`;
}

function parseSlotId(id: string): { employeeId: number; hour: number } | null {
  if (!id.startsWith(SLOT_PREFIX)) return null;
  const rest = id.slice(SLOT_PREFIX.length);
  const dash = rest.lastIndexOf("-");
  if (dash <= 0) return null;
  const emp = Number(rest.slice(0, dash));
  const hour = Number(rest.slice(dash + 1));
  if (!Number.isFinite(emp) || !Number.isFinite(hour)) return null;
  return { employeeId: emp, hour };
}

type ColumnEmp = Pick<EmployeeRow, "id" | "name">;

type ProCalendarProps = {
  day: Date;
  bookings: BookingRow[];
  employees: EmployeeRow[];
  services: ServiceRow[];
  /** For drag-and-drop: target employee must be skilled for the booking's service */
  employeeServiceLinks?: EmployeeServiceRow[];
  startHour?: number;
  endHour?: number;
  onRefresh: () => void;
  onEmptyClick: (start: Date, employeeId: number) => void;
  canCreate: boolean;
  canDrag: boolean;
  /** If set, only this employee column (staff login) */
  lockToEmployeeId?: number | null;
};

const DroppableHourCell = memo(function DroppableHourCell({
  employeeId,
  hour,
  day,
  hasBooking,
  isMobile,
  children,
  onEmptyClick,
  canCreate,
  emptySlotAriaLabel,
}: {
  employeeId: number;
  hour: number;
  day: Date;
  hasBooking: boolean;
  isMobile: boolean;
  children: ReactNode;
  onEmptyClick?: () => void;
  canCreate: boolean;
  emptySlotAriaLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: slotId(employeeId, hour),
    data: { employeeId, hour },
  });

  const hCell = isMobile ? "min-h-[5.5rem]" : "h-20";

  return (
    <div
      ref={setNodeRef}
      className={`relative border-b border-white/[0.06] ${hCell} ${
        isOver ? "bg-amber-500/10 shadow-[inset_0_0_20px_rgba(245,158,11,0.12)]" : ""
      }`}
    >
      {!hasBooking && canCreate && onEmptyClick && (
        <button
          type="button"
          aria-label={emptySlotAriaLabel}
          className={`group absolute inset-0 z-0 flex cursor-pointer touch-manipulation items-center justify-center rounded-lg border border-transparent transition-all active:bg-amber-500/15 ${
            isMobile ? "min-h-[5.25rem]" : ""
          } hover:border-amber-500/25 hover:bg-amber-500/[0.07] hover:shadow-[0_0_24px_rgba(245,158,11,0.08)]`}
          onClick={onEmptyClick}
        >
          <span className="pointer-events-none text-xs font-medium text-zinc-600 opacity-70 group-hover:text-amber-200/80 group-hover:opacity-100 md:text-[10px]">
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
  booking: BookingRow;
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
      className={`z-[2] w-full rounded-xl border border-amber-400/35 bg-gradient-to-br from-amber-500/25 via-amber-400/10 to-transparent p-2 shadow-[0_4px_24px_rgba(0,0,0,0.45),0_0_20px_rgba(245,158,11,0.12)] backdrop-blur-md transition hover:scale-[1.02] hover:border-amber-300/50 hover:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_28px_rgba(245,158,11,0.18)] active:cursor-grabbing md:touch-none ${
        isMobile ? "min-h-[4.5rem] touch-manipulation p-3 text-base" : "touch-manipulation text-xs"
      } ${isDragging ? "cursor-grabbing opacity-60 ring-2 ring-amber-400/50" : "cursor-grab"}`}
    >
      <div className={`font-semibold text-amber-50 ${isMobile ? "text-sm" : ""}`}>
        {booking.client_name}
      </div>
      <div className={`text-zinc-400 ${isMobile ? "text-sm" : "text-[11px]"}`}>{serviceName}</div>
    </div>
  );
});

export function ProCalendar({
  day,
  bookings,
  employees,
  services,
  employeeServiceLinks = [],
  startHour = 9,
  endHour = 18,
  onRefresh,
  onEmptyClick,
  canCreate,
  canDrag,
  lockToEmployeeId,
}: ProCalendarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile(768);
  const [employeeFilter, setEmployeeFilter] = useState<number | "all">("all");
  const [mobileTab, setMobileTab] = useState<"day" | "team">("day");
  const [mobileFocusId, setMobileFocusId] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<BookingRow | null>(null);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  );

  const activeList = useMemo(
    () => employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  useEffect(() => {
    if (lockToEmployeeId != null) {
      setEmployeeFilter(lockToEmployeeId);
      setMobileFocusId(lockToEmployeeId);
      return;
    }
    if (mobileFocusId == null && activeList[0]) {
      setMobileFocusId(activeList[0].id);
    }
  }, [lockToEmployeeId, activeList, mobileFocusId]);

  const filteredColumns: ColumnEmp[] = useMemo(() => {
    if (lockToEmployeeId != null) {
      const one = activeList.find((e) => e.id === lockToEmployeeId);
      return one ? [{ id: one.id, name: one.name }] : [];
    }
    if (isMobile) {
      if (employeeFilter === "all") {
        const fid = mobileFocusId ?? activeList[0]?.id;
        const em = activeList.find((e) => e.id === fid);
        return em ? [{ id: em.id, name: em.name }] : [];
      }
      const em = activeList.find((e) => e.id === employeeFilter);
      return em ? [{ id: em.id, name: em.name }] : [];
    }
    if (employeeFilter === "all") {
      return activeList.map((e) => ({ id: e.id, name: e.name }));
    }
    const em = activeList.find((e) => e.id === employeeFilter);
    return em ? [{ id: em.id, name: em.name }] : [];
  }, [activeList, employeeFilter, isMobile, mobileFocusId, lockToEmployeeId]);

  const dayBookings = useMemo(() => {
    return bookings.filter((b) => {
      try {
        const iso = b.appointment_at || b.start_at;
        if (!iso) return false;
        return isSameDay(parseISO(iso), day);
      } catch {
        return false;
      }
    });
  }, [bookings, day]);

  const bookingAt = useCallback(
    (employeeId: number, hour: number): BookingRow | undefined => {
      return dayBookings.find((b) => {
        if (b.employee_id !== employeeId) return false;
        try {
          const iso = b.appointment_at || b.start_at;
          if (!iso) return false;
          const d = parseISO(iso);
          return d.getHours() === hour;
        } catch {
          return false;
        }
      });
    },
    [dayBookings]
  );

  const serviceName = useCallback(
    (serviceId: number) => services.find((s) => s.id === serviceId)?.name_et ?? t("common.service"),
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
      const bid = Number(id.slice(BOOKING_PREFIX.length));
      const b = dayBookings.find((x) => x.id === bid);
      setActiveDrag(b ?? null);
    },
    [dayBookings]
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeId = String(active.id);
      if (!activeId.startsWith(BOOKING_PREFIX)) return;
      const bookingId = Number(activeId.slice(BOOKING_PREFIX.length));

      const parsed = parseSlotId(String(over.id));
      if (!parsed) return;

      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      if (lockToEmployeeId != null && parsed.employeeId !== lockToEmployeeId) return;

      if (!employeeCanPerformService(employeeServiceLinks, parsed.employeeId, booking.service_id)) {
        return;
      }

      const svc = services.find((s) => s.id === booking.service_id);
      const duration = (svc?.duration_min ?? 60) + (svc?.buffer_after_min ?? 10);
      const slotStart = setMinutes(setHours(startOfDay(day), parsed.hour), 0);
      const slotEnd = addMinutes(slotStart, duration);

      const clash = dayBookings.some((b) => {
        if (b.id === bookingId || b.employee_id !== parsed.employeeId) return false;
        const iv = bookingInterval(b);
        if (!iv) return false;
        return intervalsOverlap(slotStart, slotEnd, iv.start, iv.end);
      });
      if (clash) return;

      const { error } = await supabase
        .from("bookings")
        .update({
          employee_id: parsed.employeeId,
          appointment_at: slotStart.toISOString(),
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
        })
        .eq("id", bookingId);

      if (!error) onRefresh();
    },
    [bookings, day, dayBookings, employeeServiceLinks, lockToEmployeeId, onRefresh, services]
  );

  const openCreate = useCallback(
    (hour: number, employeeId: number) => {
      const start = setMinutes(setHours(startOfDay(day), hour), 0);
      onEmptyClick(start, employeeId);
    },
    [day, onEmptyClick]
  );

  const showFilter = lockToEmployeeId == null;

  return (
    <div className="space-y-4">
      {/* Mobile tabs */}
      {isMobile && showFilter && (
        <div className="flex gap-2 rounded-xl border border-white/[0.08] bg-black/40 p-1 backdrop-blur-sm md:hidden">
          <button
            type="button"
            onClick={() => setMobileTab("day")}
            className={`flex-1 rounded-lg py-3 text-sm font-semibold touch-manipulation transition ${
              mobileTab === "day"
                ? "bg-amber-500/20 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
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
                ? "bg-amber-500/20 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.15)]"
                : "text-zinc-500"
            }`}
          >
            {t("proCalendar.teamTab")}
          </button>
        </div>
      )}

      {/* Team picker (mobile) */}
      {isMobile && showFilter && mobileTab === "team" && (
        <div className="flex gap-2 overflow-x-auto pb-2 md:hidden [-webkit-overflow-scrolling:touch]">
          <button
            type="button"
            onClick={() => {
              setEmployeeFilter("all");
              setMobileTab("day");
            }}
            className={`shrink-0 rounded-full border px-5 py-3 text-sm font-medium touch-manipulation ${
              employeeFilter === "all"
                ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
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
                setEmployeeFilter("all");
                setMobileFocusId(e.id);
                setMobileTab("day");
              }}
              className={`shrink-0 rounded-full border px-5 py-3 text-sm font-medium touch-manipulation ${
                mobileFocusId === e.id && employeeFilter === "all"
                  ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                  : "border-white/10 bg-white/[0.04] text-zinc-300"
              }`}
            >
              {e.name}
            </button>
          ))}
        </div>
      )}

      {/* Desktop / filter bar */}
      {showFilter && (!isMobile || mobileTab === "day") && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden items-center gap-2 md:flex">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {t("proCalendar.staffFilter")}
            </span>
            <select
              value={employeeFilter === "all" ? "all" : String(employeeFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setEmployeeFilter(v === "all" ? "all" : Number(v));
              }}
              className="min-w-[12rem] rounded-xl border border-white/10 bg-zinc-950/80 px-4 py-2.5 text-sm text-white shadow-inner backdrop-blur-md focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            >
              <option value="all">{t("proCalendar.allEmployees")}</option>
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
          <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#050506] shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_24px_80px_rgba(0,0,0,0.65)] [-webkit-overflow-scrolling:touch]">
            <div className="flex min-w-max">
              {/* time labels */}
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

              {filteredColumns.map((emp) => (
                <div
                  key={emp.id}
                  className={`shrink-0 border-r border-white/[0.06] last:border-r-0 ${
                    isMobile ? "min-w-[min(100vw-4rem,320px)]" : "min-w-[160px] flex-1"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center border-b border-white/[0.08] font-medium text-zinc-200 ${
                      isMobile ? "min-h-[4.25rem] text-base" : "h-16 text-sm"
                    }`}
                  >
                    {emp.name}
                  </div>
                  {hours.map((h) => {
                    const b = bookingAt(emp.id, h);
                    return (
                      <DroppableHourCell
                        key={h}
                        employeeId={emp.id}
                        hour={h}
                        day={day}
                        hasBooking={!!b}
                        isMobile={isMobile}
                        canCreate={canCreate}
                        onEmptyClick={
                          !b && canCreate ? () => openCreate(h, emp.id) : undefined
                        }
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
                className={`pointer-events-none rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-500/30 to-amber-900/20 p-3 shadow-2xl backdrop-blur-md ${
                  isMobile ? "min-w-[240px] text-base" : "w-36 text-xs"
                }`}
              >
                <div className="font-semibold text-amber-50">{activeDrag.client_name}</div>
                <div className="text-zinc-400">{serviceName(activeDrag.service_id)}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
