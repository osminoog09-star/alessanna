import { format, isSameDay, parseISO, setHours, startOfDay } from "date-fns";
import type { StaffCalendarColor, StaffPublicPastelCard } from "../lib/staffCalendarColors";
import { resolveStaffPublicPastelCard } from "../lib/staffCalendarColors";
import type { AppointmentRow, StaffMember } from "../types/database";

type MiniSvc = { id: string; name: string };

function assignOverlapLanes(
  appts: Array<{ id: string; start: number; end: number }>,
): Map<string, { lane: number; laneCount: number }> {
  const sorted = [...appts].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const result = new Map<string, { lane: number; laneCount: number }>();

  for (const a of sorted) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane]! > a.start) lane++;
    if (lane === laneEnds.length) laneEnds.push(a.end);
    else laneEnds[lane] = a.end;
    result.set(a.id, { lane, laneCount: 0 });
  }
  const laneCount = Math.max(1, laneEnds.length);
  for (const id of result.keys()) {
    const prev = result.get(id)!;
    result.set(id, { lane: prev.lane, laneCount });
  }
  return result;
}

function clipToGrid(
  startMs: number,
  endMs: number,
  gridStart: number,
  gridEnd: number,
): { start: number; end: number } | null {
  const s = Math.max(startMs, gridStart);
  const e = Math.min(endMs, gridEnd);
  if (e - s < 45_000) return null;
  return { start: s, end: e };
}

export function PublicBookingDayTimeline({
  day,
  appointments,
  timelineStaff,
  staffById,
  services,
  staffColorAssignments,
  startHour = 8,
  endHour = 20,
  hourRowPx = 52,
}: {
  day: Date;
  appointments: AppointmentRow[];
  timelineStaff: StaffMember[];
  staffById: Map<string, StaffMember>;
  services: MiniSvc[];
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
  startHour?: number;
  endHour?: number;
  hourRowPx?: number;
}) {
  const svcName = (id: string) => services.find((s) => String(s.id) === String(id))?.name || "—";

  const gridStart = setHours(startOfDay(day), startHour).getTime();
  const gridEnd = setHours(startOfDay(day), endHour).getTime();
  const totalMs = gridEnd - gridStart;
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  const gridHeightPx = hours.length * hourRowPx;

  const columns = [...timelineStaff].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", "et", { sensitivity: "base" }),
  );

  if (columns.length === 0) {
    return <p className="text-sm text-zinc-500">Нет мастеров для отображения сетки.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-300/90 bg-zinc-50 shadow-inner">
      <div className="flex min-w-[520px]">
        {/* время */}
        <div className="flex w-12 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/90 sm:w-14">
          <div className="h-9 shrink-0 border-b border-zinc-200 sm:h-10" aria-hidden="true" />
          <div className="relative" style={{ height: gridHeightPx }}>
            {hours.map((h, i) => (
              <div
                key={h}
                className="absolute right-0 left-0 flex items-start justify-end border-t border-zinc-200/90 pr-1 pt-0.5 text-[10px] leading-none text-zinc-500 sm:text-[11px]"
                style={{ top: i * hourRowPx, height: hourRowPx }}
              >
                {h}:00
              </div>
            ))}
          </div>
        </div>

        {/* колонки мастеров */}
        <div className="flex min-w-0 flex-1">
          {columns.map((member) => {
            const dayAppts = appointments.filter(
              (a) =>
                a.staff_id === member.id &&
                a.status !== "cancelled" &&
                (() => {
                  try {
                    return isSameDay(parseISO(a.start_time), day);
                  } catch {
                    return false;
                  }
                })(),
            );

            const intervals = dayAppts
              .map((a) => {
                try {
                  const st = parseISO(a.start_time).getTime();
                  const en = parseISO(a.end_time).getTime();
                  const clipped = clipToGrid(st, en, gridStart, gridEnd);
                  if (!clipped) return null;
                  return { a, start: clipped.start, end: clipped.end };
                } catch {
                  return null;
                }
              })
              .filter((x): x is NonNullable<typeof x> => x != null);

            const layout = assignOverlapLanes(intervals.map((x) => ({ id: x.a.id, start: x.start, end: x.end })));

            return (
              <div
                key={member.id}
                className="min-w-[92px] flex-1 border-r border-zinc-200 last:border-r-0"
              >
                <div className="flex h-9 items-center justify-center border-b border-zinc-200 bg-zinc-100/95 px-1 text-center text-[11px] font-semibold text-zinc-800 sm:h-10 sm:text-xs">
                  <span className="line-clamp-2 leading-tight">{member.name}</span>
                </div>
                <div className="relative bg-white" style={{ height: gridHeightPx }}>
                  {hours.map((_, i) => (
                    <div
                      key={i}
                      className="pointer-events-none absolute right-0 left-0 border-t border-zinc-100"
                      style={{ top: i * hourRowPx, height: hourRowPx }}
                    />
                  ))}

                  {intervals.map(({ a, start, end }) => {
                    const topPct = ((start - gridStart) / totalMs) * 100;
                    const heightPct = ((end - start) / totalMs) * 100;
                    const L = layout.get(a.id) ?? { lane: 0, laneCount: 1 };
                    const w = 100 / L.laneCount;
                    const left = L.lane * w;
                    const pastel: StaffPublicPastelCard = resolveStaffPublicPastelCard(
                      a.staff_id,
                      staffById,
                      staffColorAssignments,
                    );
                    const t0 = format(new Date(start), "HH:mm");
                    const t1 = format(new Date(end), "HH:mm");
                    const title = (a.client_name || "").trim() || "—";
                    return (
                      <div
                        key={a.id}
                        className="absolute overflow-hidden rounded-md border px-1 py-0.5 shadow-sm sm:px-1.5 sm:py-1"
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(heightPct, 2.8)}%`,
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${w}% - 4px)`,
                          ...pastel,
                          boxSizing: "border-box",
                          zIndex: 2,
                        }}
                        title={`${title} · ${svcName(String(a.service_id))} · ${t0}–${t1}`}
                      >
                        <p className="line-clamp-2 text-[10px] font-semibold leading-snug sm:text-[11px]">
                          {title}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-[9px] leading-tight opacity-90 sm:text-[10px]">
                          {svcName(String(a.service_id))}
                        </p>
                        <p className="mt-0.5 text-[9px] tabular-nums opacity-80 sm:text-[10px]">
                          {t0}–{t1}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
