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
  StaffScheduleRow,
  StaffTimeOffRow,
} from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { appointmentInterval, intervalsOverlap } from "../../lib/slots";
import { panelStaffWorkingOnDate } from "../../lib/calendarWorkingStaff";
import { googleStaffColor } from "./receptionColors";

const START_HOUR = 8;
const END_HOUR = 21;
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
  schedules: StaffScheduleRow[];
  timeOff: StaffTimeOffRow[];
  visibleStaffIds: Set<string>;
  onSlotClick: (start: Date, anchorX: number, anchorY: number) => void;
  onApptClick: (appt: AppointmentRow, x: number, y: number) => void;
  onDayHeaderClick?: (day: Date, x: number, y: number) => void;
};

export function ReceptionWeekGrid({
  days,
  staff,
  appointments,
  services,
  schedules,
  timeOff,
  visibleStaffIds,
  onSlotClick,
  onApptClick,
  onDayHeaderClick,
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const bodyRef = useRef<HTMLDivElement>(null);
  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {/* Day header row */}
      <div className="flex shrink-0 border-b border-[#dadce0] bg-white">
        <div className="flex w-14 shrink-0 items-end justify-center pb-1 text-[10px] text-[#70757a]">
          GMT+3
        </div>
        {days.map((day, i) => {
          const isToday = isSameDay(day, now);
          const workingStaff = panelStaffWorkingOnDate(staff, schedules, day, new Set<string>(), timeOff).filter(
            (m) => visibleStaffIds.has(m.id),
          );
          const ruDay = RU_WEEK_DAYS[i] ?? "";
          return (
            <div
              key={day.toISOString()}
              className={[
                "flex min-w-0 flex-1 flex-col items-center border-l border-[#dadce0] py-1",
                onDayHeaderClick ? "cursor-pointer hover:bg-[#f1f3f4]" : "",
              ].join(" ")}
              onClick={onDayHeaderClick ? (e) => onDayHeaderClick(day, e.clientX, e.clientY) : undefined}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-[#70757a]">
                {ruDay}
              </span>
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium",
                  isToday ? "bg-[#1a73e8] text-white" : "text-[#3c4043]",
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
                    <span className="rounded px-1 py-0.5 text-[9px] text-[#70757a]">
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
      <div ref={bodyRef} className="flex min-h-0 flex-1 overflow-y-auto bg-white">
        {/* Time gutter */}
        <div className="relative w-14 shrink-0 bg-white" style={{ height: TOTAL_PX }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-2 text-[10px] text-[#70757a]"
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
                  "relative min-w-0 flex-1 cursor-pointer select-none border-l border-[#dadce0]",
                  isToday ? "bg-[#1a73e8]/[0.04]" : "",
                ].join(" ")}
                style={{ height: TOTAL_PX }}
                onClick={(e) => handleBodyClick(e, day)}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-[#e8eaed]"
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
                        backgroundImage:
                          "repeating-linear-gradient(-45deg, #c0c4cc 0, #c0c4cc 1px, transparent 0, transparent 50%)",
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
                  const topPx = timeToPx(iv.start, dayAnchor);
                  const heightPx = Math.max(timeToPx(iv.end, dayAnchor) - topPx, 20);
                  if (topPx < -20 || topPx > TOTAL_PX) return null;

                  const widthPct = 100 / totalCols;
                  const leftPct = (col / totalCols) * 100;
                  const member = staff.find((s) => s.id === appt.staff_id);
                  const c = member
                    ? googleStaffColor(member, staffHueMap)
                    : { bg: "#7986cb", fg: "#ffffff", border: "#5c6bc0" };
                  const svc = serviceMap.get(String(appt.service_id));
                  const isPast = iv.end.getTime() < now.getTime();

                  return (
                    <div
                      key={appt.id}
                      data-appt="1"
                      className="absolute cursor-pointer overflow-hidden rounded-md px-1.5 py-0.5 text-left shadow-sm transition-shadow hover:shadow-md"
                      style={{
                        top: topPx + 1,
                        height: heightPx - 2,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: c.bg,
                        color: c.fg,
                        opacity: isPast ? 0.45 : 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApptClick(appt, e.clientX, e.clientY);
                      }}
                    >
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {appt.client_name}
                      </p>
                      {heightPx > 28 && (
                        <p className="truncate text-[10px] leading-tight opacity-90">
                          {format(iv.start, "HH:mm")}
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
