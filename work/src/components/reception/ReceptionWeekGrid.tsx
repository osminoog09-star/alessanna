import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMinutes,
  format,
  isSameDay,
  parseISO,
  setHours,
  startOfDay,
} from "date-fns";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
  StaffTimeOffRow,
  StaffWorkDateRow,
} from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { appointmentInterval, intervalsOverlap } from "../../lib/slots";
import { googleStaffColor } from "./receptionColors";

const START_HOUR = 0;
const END_HOUR = 24;
const PX_PER_HOUR = 64;
const TOTAL_PX = (END_HOUR - START_HOUR) * PX_PER_HOUR;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const RU_WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function timeToPx(date: Date, dayAnchor: Date): number {
  const diffMs = date.getTime() - dayAnchor.getTime();
  return (diffMs / 3_600_000) * PX_PER_HOUR;
}

type ApptLayout = {
  appt: AppointmentRow;
  col: number;
  totalCols: number;
};

function computeOverlapLayout(appts: AppointmentRow[]): ApptLayout[] {
  const sorted = [...appts].sort(
    (a, b) => parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime(),
  );
  const colEnds: Date[] = [];
  const colAssignments: number[] = [];

  for (const appt of sorted) {
    const iv = appointmentInterval(appt);
    if (!iv) { colAssignments.push(0); continue; }
    let assignedCol = colEnds.findIndex((end) => end.getTime() <= iv.start.getTime());
    if (assignedCol === -1) assignedCol = colEnds.length;
    colEnds[assignedCol] = iv.end;
    colAssignments.push(assignedCol);
  }

  return sorted.map((appt, i) => {
    const iv = appointmentInterval(appt);
    if (!iv) return { appt, col: 0, totalCols: 1 };
    let maxCol = colAssignments[i] ?? 0;
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const otherIv = appointmentInterval(sorted[j]!);
      if (!otherIv) continue;
      if (intervalsOverlap(iv.start, iv.end, otherIv.start, otherIv.end)) {
        maxCol = Math.max(maxCol, colAssignments[j] ?? 0);
      }
    }
    return { appt, col: colAssignments[i] ?? 0, totalCols: maxCol + 1 };
  });
}

type Props = {
  days: Date[];
  staff: StaffMember[];
  appointments: AppointmentRow[];
  services: ServiceRow[];
  timeOff: StaffTimeOffRow[];
  workDates: StaffWorkDateRow[];
  visibleStaffIds: Set<string>;
  onSlotClick: (start: Date, anchorX: number, anchorY: number) => void;
  onApptClick: (appt: AppointmentRow, x: number, y: number) => void;
  onApptResize?: (appt: AppointmentRow, newStart: Date, newEnd: Date) => void;
  onDayHeaderClick?: (day: Date, x: number, y: number) => void;
  dark?: boolean;
};

export function ReceptionWeekGrid({
  days,
  staff,
  appointments,
  services,
  timeOff,
  workDates,
  visibleStaffIds,
  onSlotClick,
  onApptClick,
  onApptResize,
  onDayHeaderClick,
  dark,
}: Props) {
  const bg = dark ? "bg-panel" : "bg-white";
  const borderCls = dark ? "border-line/15" : "border-[#dadce0]";
  const mutedCls = dark ? "text-muted" : "text-[#70757a]";
  const textCls = dark ? "text-fg" : "text-[#3c4043]";
  const hoverCls = dark ? "hover:bg-white/5" : "hover:bg-[#f1f3f4]";
  const hrLine = dark ? "border-line/10" : "border-[#e8eaed]";
  const todayBg = dark ? "bg-blue-500/[0.05]" : "bg-[#1a73e8]/[0.04]";
  const stripes = dark
    ? "repeating-linear-gradient(-45deg, rgba(255,255,255,0.12) 0, rgba(255,255,255,0.12) 1px, transparent 0, transparent 50%)"
    : "repeating-linear-gradient(-45deg, #c0c4cc 0, #c0c4cc 1px, transparent 0, transparent 50%)";
  const [now, setNow] = useState(() => new Date());
  const bodyRef = useRef<HTMLDivElement>(null);
  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  // Drag-to-resize: grabbing the top half of a booking moves its start time,
  // the bottom half moves its end time. Snaps to 30-minute steps. A press
  // without movement is treated as a normal click (opens the edit popup).
  const RESIZE_STEP_MIN = 30;
  const dragRef = useRef<{
    appt: AppointmentRow;
    edge: "top" | "bottom";
    origStart: Date;
    origEnd: Date;
    startClientY: number;
    moved: boolean;
    curStart: Date;
    curEnd: Date;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: Date; end: Date } | null>(null);

  function handleApptPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    appt: AppointmentRow,
    start: Date,
    end: Date,
  ) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge: "top" | "bottom" = e.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
    dragRef.current = {
      appt,
      edge,
      origStart: start,
      origEnd: end,
      startClientY: e.clientY,
      moved: false,
      curStart: start,
      curEnd: end,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handleApptPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const deltaPx = e.clientY - d.startClientY;
    if (!d.moved && Math.abs(deltaPx) > 3) d.moved = true;
    if (!d.moved) return;
    const stepPx = (RESIZE_STEP_MIN / 60) * PX_PER_HOUR;
    const steps = Math.round(deltaPx / stepPx);
    const deltaMin = steps * RESIZE_STEP_MIN;
    let start = d.origStart;
    let end = d.origEnd;
    if (d.edge === "top") {
      start = addMinutes(d.origStart, deltaMin);
      if (start.getTime() >= end.getTime()) start = addMinutes(end, -RESIZE_STEP_MIN);
    } else {
      end = addMinutes(d.origEnd, deltaMin);
      if (end.getTime() <= start.getTime()) end = addMinutes(start, RESIZE_STEP_MIN);
    }
    d.curStart = start;
    d.curEnd = end;
    setPreview({ id: d.appt.id, start, end });
  }

  function handleApptPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    setPreview(null);
    if (!d) return;
    if (!d.moved) {
      onApptClick(d.appt, e.clientX, e.clientY);
      return;
    }
    const changed =
      d.curStart.getTime() !== d.origStart.getTime() ||
      d.curEnd.getTime() !== d.origEnd.getTime();
    if (changed && onApptResize) onApptResize(d.appt, d.curStart, d.curEnd);
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Open at ~10:00 (typical salon start) on mount; the full 00:00–24:00
  // grid stays scrollable inside the body so any hour can be reached
  // earlier or later, like a normal calendar.
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = Math.max(0, (8 - START_HOUR) * PX_PER_HOUR - 8);
    }
  }, []);

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>, day: Date) {
    if ((e.target as HTMLElement).closest("[data-appt]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollTop = bodyRef.current?.scrollTop ?? 0;
    const yOffset = e.clientY - rect.top + scrollTop;
    const minutesFromStart = Math.floor((yOffset / PX_PER_HOUR) * 60);
    const snappedMinutes = Math.max(0, Math.floor(minutesFromStart / 15) * 15);
    const dayAnchor = setHours(startOfDay(day), START_HOUR);
    const clickedTime = addMinutes(dayAnchor, snappedMinutes);
    onSlotClick(clickedTime, e.clientX, e.clientY);
  }

  const serviceMap = useMemo(() => {
    const m = new Map<string, ServiceRow>();
    for (const s of services) m.set(String(s.id), s);
    return m;
  }, [services]);

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${bg}`}>
      {/* Day header row */}
      <div className={`flex shrink-0 border-b ${borderCls} ${bg}`}>
        <div className={`flex w-14 shrink-0 items-end justify-center pb-1 text-[10px] ${mutedCls}`}>
          GMT+3
        </div>
        {days.map((day, i) => {
          const isToday = isSameDay(day, now);
          const dateStr = format(day, "yyyy-MM-dd");
          const workingIds = new Set(
            workDates.filter((r) => r.work_date === dateStr).map((r) => r.staff_id),
          );
          const workingStaff = staff
            .filter((m) => workingIds.has(m.id) && visibleStaffIds.has(m.id))
            .sort((a, b) => a.name.localeCompare(b.name, "et", { sensitivity: "base" }));
          const ruDay = RU_WEEK_DAYS[i] ?? "";
          return (
            <div
              key={day.toISOString()}
              className={[
                `flex min-w-0 flex-1 flex-col items-center border-l ${borderCls} py-1`,
                onDayHeaderClick ? `cursor-pointer ${hoverCls}` : "",
              ].join(" ")}
              onClick={onDayHeaderClick ? (e) => onDayHeaderClick(day, e.clientX, e.clientY) : undefined}
            >
              <span className={`text-[11px] font-medium uppercase tracking-wide ${mutedCls}`}>
                {ruDay}
              </span>
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium",
                  isToday ? "bg-[#1a73e8] text-white" : textCls,
                ].join(" ")}
              >
                {format(day, "d")}
              </span>
              {workingStaff.length > 0 && (
                <div className="mt-0.5 flex flex-wrap justify-center gap-0.5 px-1">
                  {workingStaff.slice(0, 4).map((m) => {
                    const c = googleStaffColor(m, staffHueMap);
                    return (
                      <span
                        key={m.id}
                        className="max-w-[56px] truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: c.bg, color: c.fg }}
                      >
                        {m.name.split(" ")[0]}
                      </span>
                    );
                  })}
                  {workingStaff.length > 4 && (
                    <span className={`rounded px-1 py-0.5 text-[9px] ${mutedCls}`}>
                      +{workingStaff.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable time body */}
      <div ref={bodyRef} className={`flex min-h-0 flex-1 overflow-y-scroll ${bg}`}>
        {/* Time gutter */}
        <div className={`relative w-14 shrink-0 ${bg}`} style={{ height: TOTAL_PX }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className={`absolute right-2 text-[10px] ${mutedCls}`}
              style={{ top: (h - START_HOUR) * PX_PER_HOUR - 6 }}
            >
              {h.toString().padStart(2, "0")}:00
            </div>
          ))}
          {days.some((d) => isSameDay(d, now)) && (
            <div
              className="absolute right-0 h-2.5 w-2.5 rounded-full bg-[#ea4335]"
              style={{
                top:
                  (now.getHours() - START_HOUR) * PX_PER_HOUR +
                  (now.getMinutes() / 60) * PX_PER_HOUR - 5,
              }}
            />
          )}
        </div>

        {/* Day columns */}
        <div className="flex flex-1">
          {days.map((day) => {
            const dayAnchor = setHours(startOfDay(day), START_HOUR);
            const isToday = isSameDay(day, now);

            const dayAppts = appointments.filter((a) => {
              if (!visibleStaffIds.has(a.staff_id)) return false;
              const iv = appointmentInterval(a);
              if (!iv) return false;
              // Hide legacy all-day "work-day" blocks (≥16h) — they're schedule
              // markers, not real bookings, and would fill the whole column.
              if (iv.end.getTime() - iv.start.getTime() >= 16 * 3_600_000) return false;
              return isSameDay(iv.start, day);
            });

            const dayTimeOff = timeOff.filter((to) => {
              if (!visibleStaffIds.has(to.staff_id)) return false;
              const iv = appointmentInterval({ start_time: to.start_time, end_time: to.end_time });
              if (!iv) return false;
              return isSameDay(iv.start, day);
            });

            const layouts = computeOverlapLayout(dayAppts);

            return (
              <div
                key={day.toISOString()}
                className={[
                  `relative min-w-0 flex-1 cursor-pointer select-none border-l ${borderCls}`,
                  isToday ? todayBg : "",
                ].join(" ")}
                style={{ height: TOTAL_PX }}
                onClick={(e) => handleBodyClick(e, day)}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className={`pointer-events-none absolute inset-x-0 border-t ${hrLine}`}
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                  />
                ))}

                {/* Time-off zones */}
                {dayTimeOff.map((to) => {
                  const iv = appointmentInterval({ start_time: to.start_time, end_time: to.end_time });
                  if (!iv) return null;
                  const topPx = timeToPx(iv.start, dayAnchor);
                  const heightPx = Math.max(timeToPx(iv.end, dayAnchor) - topPx, 8);
                  if (topPx < 0 || topPx > TOTAL_PX) return null;
                  return (
                    <div
                      key={to.id}
                      className="pointer-events-none absolute inset-x-0 opacity-30"
                      style={{
                        top: topPx,
                        height: heightPx,
                        backgroundImage: stripes,
                        backgroundSize: "6px 6px",
                      }}
                    />
                  );
                })}

                {/* Current time line */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-[2px] bg-[#ea4335]"
                    style={{
                      top:
                        (now.getHours() - START_HOUR) * PX_PER_HOUR +
                        (now.getMinutes() / 60) * PX_PER_HOUR,
                    }}
                  />
                )}

                {/* Appointment cards */}
                {layouts.map(({ appt, col, totalCols }) => {
                  const iv = appointmentInterval(appt);
                  if (!iv) return null;
                  const isResizing = preview?.id === appt.id;
                  const effStart = isResizing ? preview!.start : iv.start;
                  const effEnd = isResizing ? preview!.end : iv.end;
                  const topPx = timeToPx(effStart, dayAnchor);
                  const heightPx = Math.max(timeToPx(effEnd, dayAnchor) - topPx, 20);
                  if (topPx < -20 || topPx > TOTAL_PX) return null;

                  const widthPct = 100 / totalCols;
                  const leftPct = (col / totalCols) * 100;
                  const member = staff.find((s) => s.id === appt.staff_id);
                  const c = member
                    ? googleStaffColor(member, staffHueMap)
                    : { bg: "#7986cb", fg: "#ffffff", border: "#5c6bc0" };
                  const svc = serviceMap.get(String(appt.service_id));
                  const isPast = effEnd.getTime() < now.getTime();

                  return (
                    <div
                      key={appt.id}
                      data-appt="1"
                      className="absolute touch-none overflow-hidden rounded-md px-1.5 py-0.5 text-left shadow-sm transition-shadow hover:shadow-md"
                      style={{
                        top: topPx + 1,
                        height: heightPx - 2,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: c.bg,
                        color: c.fg,
                        opacity: isPast ? 0.45 : 1,
                        cursor: isResizing ? "ns-resize" : "pointer",
                        zIndex: isResizing ? 20 : undefined,
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        handleApptPointerDown(e, appt, iv.start, iv.end);
                      }}
                      onPointerMove={handleApptPointerMove}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        handleApptPointerUp(e);
                      }}
                    >
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {appt.client_name}
                      </p>
                      {heightPx > 28 && (
                        <p className="truncate text-[10px] leading-tight opacity-90">
                          {format(effStart, "HH:mm")}–{format(effEnd, "HH:mm")}
                          {svc ? ` · ${svc.name_et}` : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
