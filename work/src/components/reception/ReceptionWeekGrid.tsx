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
import { staffCrmAppointmentBlockStyle } from "../../lib/staffCalendarColors";
import { appointmentInterval, intervalsOverlap } from "../../lib/slots";
import { panelStaffWorkingOnDate } from "../../lib/calendarWorkingStaff";

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

function staffDotColor(member: StaffMember, hueMap: Map<string, number>): string {
  const hex = member.calendar_color_hex?.trim();
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const hue = hueMap.get(member.id) ?? 200;
  return `hsl(${hue} 70% 50%)`;
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
}: Props) {
  const [now, setNow] = useState(() => new Date());
  const bodyRef = useRef<HTMLDivElement>(null);
  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>, day: Date) {
    // Don't open popup if clicking an existing appointment
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Day header row */}
      <div className="flex shrink-0 border-b border-zinc-800">
        {/* Gutter header (timezone) */}
        <div className="flex w-12 shrink-0 items-end justify-center pb-1 text-[10px] text-zinc-500">
          GMT+3
        </div>
        {/* Day headers */}
        {days.map((day, i) => {
          const isToday = isSameDay(day, now);
          const workingStaff = panelStaffWorkingOnDate(staff, schedules, day, new Set<string>()).filter(
            (m) => visibleStaffIds.has(m.id),
          );
          const ruDay = RU_WEEK_DAYS[i] ?? "";
          return (
            <div
              key={day.toISOString()}
              className="flex min-w-0 flex-1 flex-col items-center border-l border-zinc-800 py-1"
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {ruDay}
              </span>
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold",
                  isToday ? "bg-blue-600 text-white" : "text-zinc-200",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>
              {/* Working staff chips */}
              {workingStaff.length > 0 && (
                <div className="mt-0.5 flex flex-wrap justify-center gap-0.5 px-1">
                  {workingStaff.slice(0, 4).map((m) => (
                    <span
                      key={m.id}
                      className="max-w-[48px] truncate rounded px-1 py-0.5 text-[9px] font-medium text-white/90"
                      style={{ backgroundColor: staffDotColor(m, staffHueMap) + "cc" }}
                    >
                      {m.name.split(" ")[0]}
                    </span>
                  ))}
                  {workingStaff.length > 4 && (
                    <span className="rounded px-1 py-0.5 text-[9px] text-zinc-500">
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
      <div ref={bodyRef} className="flex min-h-0 flex-1 overflow-y-auto">
        {/* Time gutter */}
        <div className="relative w-12 shrink-0" style={{ height: TOTAL_PX }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-1 text-[10px] text-zinc-500"
              style={{ top: (h - START_HOUR) * PX_PER_HOUR - 6 }}
            >
              {h.toString().padStart(2, "0")}:00
            </div>
          ))}
          {/* Red dot for current time */}
          {isSameDay(now, days[0] ?? new Date()) ||
          days.some((d) => isSameDay(d, now)) ? (
            <div
              className="absolute right-0 h-2.5 w-2.5 rounded-full bg-red-500"
              style={{
                top:
                  (now.getHours() - START_HOUR) * PX_PER_HOUR +
                  (now.getMinutes() / 60) * PX_PER_HOUR -
                  5,
              }}
            />
          ) : null}
        </div>

        {/* Day columns */}
        <div className="flex flex-1">
          {days.map((day) => {
            const dayAnchor = setHours(startOfDay(day), START_HOUR);
            const isToday = isSameDay(day, now);

            // Appointments for this day, filtered by visible staff
            const dayAppts = appointments.filter((a) => {
              if (!visibleStaffIds.has(a.staff_id)) return false;
              const iv = appointmentInterval(a);
              if (!iv) return false;
              return isSameDay(iv.start, day);
            });

            // Time-off blocks for visible staff on this day
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
                  "relative min-w-0 flex-1 cursor-pointer select-none border-l border-zinc-800",
                  isToday ? "bg-blue-950/10" : "",
                ].join(" ")}
                style={{ height: TOTAL_PX }}
                onClick={(e) => handleBodyClick(e, day)}
              >
                {/* Hour grid lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-zinc-800"
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={`half-${h}`}
                    className="pointer-events-none absolute inset-x-0 border-t border-zinc-800/50"
                    style={{ top: (h - START_HOUR) * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                  />
                ))}

                {/* Time-off zones (diagonal stripes) */}
                {dayTimeOff.map((to) => {
                  const iv = appointmentInterval({
                    start_time: to.start_time,
                    end_time: to.end_time,
                  });
                  if (!iv) return null;
                  const topPx = timeToPx(iv.start, dayAnchor);
                  const heightPx = Math.max(timeToPx(iv.end, dayAnchor) - topPx, 8);
                  if (topPx < 0 || topPx > TOTAL_PX) return null;
                  return (
                    <div
                      key={to.id}
                      className="pointer-events-none absolute inset-x-0 opacity-40"
                      style={{
                        top: topPx,
                        height: heightPx,
                        backgroundImage:
                          "repeating-linear-gradient(-45deg, #ef4444 0, #ef4444 1px, transparent 0, transparent 50%)",
                        backgroundSize: "6px 6px",
                      }}
                    />
                  );
                })}

                {/* Current time line */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 h-px bg-red-500"
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
                  const heightPx = Math.max(
                    timeToPx(iv.end, dayAnchor) - topPx,
                    20,
                  );
                  if (topPx < -20 || topPx > TOTAL_PX) return null;

                  const widthPct = 100 / totalCols;
                  const leftPct = (col / totalCols) * 100;
                  const colorStyle = staffCrmAppointmentBlockStyle(appt.staff_id, staff, staffHueMap);
                  const svc = serviceMap.get(String(appt.service_id));

                  return (
                    <div
                      key={appt.id}
                      data-appt="1"
                      className="absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left transition-opacity hover:opacity-80"
                      style={{
                        top: topPx + 1,
                        height: heightPx - 2,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                        ...colorStyle,
                        borderColor: (colorStyle.borderColor as string) ?? "#60a5fa",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {appt.client_name}
                      </p>
                      {heightPx > 28 && (
                        <p className="truncate text-[10px] leading-tight opacity-80">
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
