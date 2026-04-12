import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { addMinutes, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { useTranslation } from "react-i18next";
import type { CalendarServiceBlock } from "../../lib/calendarBlocks";
import type { ServiceListingRow, StaffScheduleRow, StaffTimeOffRow } from "../../types/database";
import { appointmentInterval } from "../../lib/slots";
import {
  blockPercentStyle,
  clickToSnappedDate,
  isIntervalInsideWorkingWindows,
  workingMinuteWindowsForDay,
  windowsToDayRanges,
} from "../../lib/salonCalendar";

const PX_PER_HOUR = 52;

type Props = {
  day: Date;
  staffId: string;
  /** Distinct appointment block color per staff column (day view). */
  accentHue?: number;
  blocks: CalendarServiceBlock[];
  services: ServiceListingRow[];
  schedules: StaffScheduleRow[];
  timeOff: StaffTimeOffRow[];
  startHour?: number;
  endHour?: number;
  onEmptyClick: (start: Date, staffId: string) => void;
  onBlockTime?: (start: Date, staffId: string) => void;
  canCreate: boolean;
  canBlockTime?: boolean;
  canDeleteAppointments?: boolean;
  /** Cancels whole visit (appointment id). */
  onCancelVisit?: (appointmentId: string) => void;
  compact?: boolean;
};

export function SalonTimelineGrid({
  day,
  staffId,
  accentHue,
  blocks,
  services,
  schedules,
  timeOff,
  startHour = 9,
  endHour = 21,
  onEmptyClick,
  onBlockTime,
  canCreate,
  canBlockTime = false,
  canDeleteAppointments = false,
  onCancelVisit,
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  );

  const totalHeightPx = (endHour - startHour) * PX_PER_HOUR;

  const weekday = day.getDay();
  const workingWindows = useMemo(
    () => workingMinuteWindowsForDay(schedules, staffId, weekday),
    [schedules, staffId, weekday]
  );

  const workingRanges = useMemo(() => windowsToDayRanges(day, workingWindows), [day, workingWindows]);

  const dayBlocks = useMemo(() => {
    return blocks.filter((b) => {
      if (b.staff_id !== staffId) return false;
      try {
        return isSameDay(parseISO(b.start_time), day);
      } catch {
        return false;
      }
    });
  }, [blocks, staffId, day]);

  const dayOff = useMemo(() => {
    const d0 = startOfDay(day);
    const d1 = addMinutes(d0, 24 * 60);
    return timeOff.filter((b) => {
      if (b.staff_id !== staffId) return false;
      const iv = appointmentInterval({ start_time: b.start_time, end_time: b.end_time });
      if (!iv) return false;
      return iv.start < d1 && iv.end > d0;
    });
  }, [timeOff, staffId, day]);

  const serviceLabel = useCallback(
    (b: CalendarServiceBlock) =>
      b.service_name_et || services.find((s) => s.id === b.service_id)?.name || t("common.service"),
    [services, t]
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canCreate || !gridRef.current) return;
      if ((e.target as HTMLElement).closest("[data-calendar-block]")) return;

      const rect = gridRef.current.getBoundingClientRect();
      const start = clickToSnappedDate(e.clientY, rect.top, rect.height, day, startHour, endHour, 15);
      if (!isIntervalInsideWorkingWindows(start, addMinutes(start, 15), workingWindows, day)) return;

      const endProbe = addMinutes(start, 60);
      const busy = dayBlocks.some((b) => {
        const iv = appointmentInterval({ start_time: b.start_time, end_time: b.end_time });
        if (!iv) return false;
        return start < iv.end && endProbe > iv.start;
      });
      if (busy) return;

      const offOverlap = dayOff.some((b) => {
        const iv = appointmentInterval({ start_time: b.start_time, end_time: b.end_time });
        if (!iv) return false;
        return start < iv.end && endProbe > iv.start;
      });
      if (offOverlap) return;

      onEmptyClick(start, staffId);
    },
    [canCreate, day, startHour, endHour, workingWindows, dayBlocks, dayOff, onEmptyClick, staffId]
  );

  const d0 = startOfDay(day);
  const d1 = addMinutes(d0, 24 * 60);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-zinc-800/90 bg-[#0c0c0e] shadow-inner ${
        compact ? "min-h-[280px]" : "min-h-[320px]"
      }`}
    >
      <div className="flex border-b border-zinc-800/80 bg-zinc-900/50 px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {format(day, compact ? "EEE d" : "EEEE d MMM")}
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          className="w-10 shrink-0 border-r border-zinc-800/80 py-0 text-right text-[10px] text-zinc-600 sm:w-11"
          style={{ paddingTop: 0 }}
        >
          {hours.map((h) => (
            <div key={h} className="flex items-start justify-end pr-1" style={{ height: PX_PER_HOUR }}>
              {h}:00
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={gridRef}
            role="presentation"
            className="relative cursor-crosshair"
            style={{ height: totalHeightPx }}
            onClick={handleBackgroundClick}
          >
            <div className="absolute inset-0 bg-zinc-950/90" />

            {workingRanges.map((r, i) => {
              const st = blockPercentStyle(r.start, r.end, day, startHour, endHour);
              return (
                <div
                  key={i}
                  className="pointer-events-none absolute left-0 right-0 bg-emerald-950/25 ring-1 ring-inset ring-emerald-900/20"
                  style={{ top: st.top, height: st.height }}
                />
              );
            })}

            {workingWindows.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-2 text-center text-[10px] text-zinc-600">
                {t("salonCalendar.noSchedule")}
              </div>
            )}

            {dayOff.map((b) => {
              const iv = appointmentInterval({ start_time: b.start_time, end_time: b.end_time });
              if (!iv || iv.end <= d0 || iv.start >= d1) return null;
              const clipStart = iv.start < d0 ? d0 : iv.start;
              const clipEnd = iv.end > d1 ? d1 : iv.end;
              const st = blockPercentStyle(clipStart, clipEnd, day, startHour, endHour);
              const typ = b.time_off_type ?? "manual_block";
              const offVisual =
                typ === "sick_leave"
                  ? "border-amber-500/45 bg-amber-950/75 text-amber-50"
                  : typ === "day_off"
                    ? "border-violet-500/40 bg-violet-950/70 text-violet-50"
                    : "border-red-500/40 bg-red-950/70 text-red-100";
              return (
                <div
                  key={b.id}
                  data-calendar-block="timeoff"
                  className={`pointer-events-auto absolute left-1 right-1 z-[5] rounded-md border px-1.5 py-1 text-[10px] shadow-sm backdrop-blur-sm ${offVisual}`}
                  style={{ top: st.top, height: st.height, minHeight: compact ? 18 : 22 }}
                  title={b.reason ?? t("salonCalendar.blocked")}
                >
                  <span className="font-medium">
                    {typ === "sick_leave"
                      ? t("timeOffType.sick_leave")
                      : typ === "day_off"
                        ? t("timeOffType.day_off")
                        : t("salonCalendar.blocked")}
                  </span>
                  {b.reason && <span className="block truncate opacity-90">{b.reason}</span>}
                </div>
              );
            })}

            {dayBlocks.map((b) => {
              const iv = appointmentInterval({ start_time: b.start_time, end_time: b.end_time });
              if (!iv) return null;
              if (iv.end <= d0 || iv.start >= d1) return null;
              const clipStart = iv.start < d0 ? d0 : iv.start;
              const clipEnd = iv.end > d1 ? d1 : iv.end;
              const st = blockPercentStyle(clipStart, clipEnd, day, startHour, endHour);
              const hue = accentHue ?? 200;
              const apptStyle: CSSProperties = {
                top: st.top,
                height: st.height,
                minHeight: compact ? 22 : 28,
                borderColor: `hsla(${hue}, 65%, 48%, 0.55)`,
                background: `linear-gradient(135deg, hsla(${hue}, 55%, 38%, 0.42), hsla(${hue}, 45%, 22%, 0.5))`,
              };
              return (
                <div
                  key={b.id}
                  data-calendar-block="appointment"
                  className="pointer-events-auto absolute left-1 right-1 z-[6] flex flex-col justify-center rounded-md border px-1.5 py-1 text-left shadow-md backdrop-blur-sm"
                  style={apptStyle}
                >
                  <p
                    className={`truncate font-semibold text-white ${compact ? "text-[10px]" : "text-xs"}`}
                    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
                  >
                    {b.client_name}
                  </p>
                  <p
                    className={`truncate ${compact ? "text-[9px]" : "text-[10px]"}`}
                    style={{ color: `hsla(${hue}, 80%, 88%, 0.95)` }}
                  >
                    {serviceLabel(b)}
                  </p>
                  {!compact && b.staff_name && (
                    <p className="truncate text-[9px] text-white/75">{b.staff_name}</p>
                  )}
                  <p className={`text-white/70 ${compact ? "text-[9px]" : "text-[10px]"}`}>
                    {format(clipStart, "HH:mm")} – {format(clipEnd, "HH:mm")}
                  </p>
                  {canDeleteAppointments && onCancelVisit && (
                    <button
                      type="button"
                      className="mt-0.5 self-end text-[9px] font-medium text-red-300 hover:text-red-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(t("salonCalendar.cancelAppointmentConfirm"))) {
                          onCancelVisit(b.appointment_id);
                        }
                      }}
                    >
                      {t("salonCalendar.cancelBooking")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {canBlockTime && onBlockTime && (
            <div className="border-t border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
              <button
                type="button"
                className="w-full rounded-md border border-red-900/50 bg-red-950/30 py-1.5 text-[11px] font-medium text-red-200/90 hover:bg-red-950/50"
                onClick={() => {
                  const anchor = addMinutes(d0, startHour * 60);
                  onBlockTime(anchor, staffId);
                }}
              >
                {t("salonCalendar.blockTime")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
