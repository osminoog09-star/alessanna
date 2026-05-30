import { useMemo } from "react";
import {
  addDays,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type {
  AppointmentRow,
  ServiceRow,
  StaffMember,
} from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";

const RU_WEEK_DAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function staffChipColor(member: StaffMember, hueMap: Map<string, number>): string {
  const hex = member.calendar_color_hex?.trim();
  if (hex && /^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const hue = hueMap.get(member.id) ?? 200;
  return `hsl(${hue}, 65%, 45%)`;
}

type Props = {
  cursor: Date;
  staff: StaffMember[];
  appointments: AppointmentRow[];
  services: ServiceRow[];
  visibleStaffIds: Set<string>;
  onDayClick: (day: Date) => void;
  onApptClick: (appt: AppointmentRow, x: number, y: number) => void;
};

export function ReceptionMonthView({
  cursor,
  staff,
  appointments,
  services,
  visibleStaffIds,
  onDayClick,
  onApptClick,
}: Props) {
  const today = new Date();
  const staffHueMap = useMemo(() => buildStaffHueMap(staff.map((m) => m.id)), [staff]);

  const serviceMap = useMemo(() => {
    const m = new Map<string, ServiceRow>();
    for (const s of services) m.set(String(s.id), s);
    return m;
  }, [services]);

  const staffMap = useMemo(() => {
    const m = new Map<string, StaffMember>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  // Build 6-week grid starting Monday
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridDays = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) });

  // Group visible appointments by day (ISO date string key)
  const apptsByDay = useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const appt of appointments) {
      if (!visibleStaffIds.has(appt.staff_id)) continue;
      try {
        const dt = parseISO(appt.start_time);
        const key = format(dt, "yyyy-MM-dd");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(appt);
      } catch {
        // skip invalid
      }
    }
    // Sort each day's appointments by start time
    for (const [, appts] of map) {
      appts.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  }, [appointments, visibleStaffIds]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Column headers */}
      <div className="grid shrink-0 grid-cols-7 border-b border-zinc-800">
        {RU_WEEK_DAYS_SHORT.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden">
        {gridDays.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayAppts = apptsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          const isCurrentMonth = isSameMonth(day, cursor);
          const MAX_VISIBLE = 3;
          const visibleAppts = dayAppts.slice(0, MAX_VISIBLE);
          const hiddenCount = dayAppts.length - MAX_VISIBLE;

          return (
            <div
              key={key}
              className={[
                "relative flex min-h-0 flex-col overflow-hidden border-b border-r border-zinc-800 p-1",
                isCurrentMonth ? "" : "opacity-40",
              ].join(" ")}
            >
              {/* Day number */}
              <button
                onClick={() => onDayClick(day)}
                className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full text-xs font-semibold"
                style={
                  isToday
                    ? { backgroundColor: "#2563eb", color: "white" }
                    : { color: "#d4d4d8" }
                }
              >
                {format(day, "d")}
              </button>

              {/* Appointment pills */}
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {visibleAppts.map((appt) => {
                  const member = staffMap.get(appt.staff_id);
                  const bg = member ? staffChipColor(member, staffHueMap) : "#4b5563";
                  const svc = serviceMap.get(String(appt.service_id));
                  const startTime = (() => {
                    try { return format(parseISO(appt.start_time), "HH:mm"); } catch { return ""; }
                  })();
                  return (
                    <button
                      key={appt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApptClick(appt, e.clientX, e.clientY);
                      }}
                      className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium text-white hover:brightness-110"
                      style={{ backgroundColor: bg }}
                    >
                      {startTime} {appt.client_name}
                      {svc ? ` · ${svc.name_et}` : ""}
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    onClick={() => onDayClick(day)}
                    className="text-left text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    +{hiddenCount} ещё
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
