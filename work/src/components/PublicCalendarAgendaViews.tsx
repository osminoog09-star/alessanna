import { format } from "date-fns";
import type { i18n } from "i18next";
import { compareSalonYmd, salonYmdFromAnyDate } from "../lib/bookingSalonTz";
import { resolveStaffPublicCalendarLook, type StaffCalendarColor } from "../lib/staffCalendarColors";
import type { AppointmentRow, StaffMember } from "../types/database";

type MiniSvc = { id: string; name: string };

function apptsForDay(appointments: AppointmentRow[], day: Date): AppointmentRow[] {
  const key = salonYmdFromAnyDate(day);
  return appointments
    .filter(
      (ap) => ap.status !== "cancelled" && salonYmdFromAnyDate(new Date(ap.start_time)) === key,
    )
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

export function PublicCalendarDayAgenda({
  day,
  appointments,
  staffById,
  services,
  i18n,
  staffColorAssignments,
}: {
  day: Date;
  appointments: AppointmentRow[];
  staffById: Map<string, StaffMember>;
  services: MiniSvc[];
  i18n: i18n;
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
}) {
  const list = apptsForDay(appointments, day);
  const svcName = (id: string) => services.find((s) => String(s.id) === String(id))?.name || "—";

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-zinc-400">
        {format(day, "EEEE, d MMMM yyyy", { locale: undefined })}
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-zinc-600">Нет записей на этот день.</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((ap) => {
            const look = resolveStaffPublicCalendarLook(ap.staff_id, staffById, staffColorAssignments);
            const master = staffById.get(ap.staff_id);
            const start = new Date(ap.start_time);
            const end = new Date(ap.end_time);
            return (
              <li
                key={ap.id}
                className={
                  look.kind === "google"
                    ? "rounded-xl border border-zinc-800 py-3 pr-4 pl-4"
                    : `rounded-xl border border-zinc-800 bg-zinc-950/70 pl-0 ${look.palette.strip} py-3 pr-4`
                }
                style={
                  look.kind === "google"
                    ? { borderLeftWidth: 4, borderLeftStyle: "solid", borderLeftColor: look.bg, backgroundColor: look.soft }
                    : undefined
                }
              >
                <div className={look.kind === "google" ? "" : "pl-4"}>
                  <div className="text-sm font-semibold tabular-nums text-zinc-50">
                    {start.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })} –{" "}
                    {end.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="mt-1 text-sm text-zinc-200">
                    <span
                      className={look.kind === "palette" ? look.palette.text : undefined}
                      style={look.kind === "google" ? { color: look.fg } : undefined}
                    >
                      {master?.name || "—"}
                    </span>
                    <span className="text-zinc-500"> · </span>
                    <span>{svcName(String(ap.service_id))}</span>
                  </div>
                  {ap.client_name && (
                    <div className="mt-1 text-xs text-zinc-500">{ap.client_name}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PublicCalendarWeekAgenda({
  weekDays,
  appointments,
  staffById,
  services,
  i18n,
  selectedDayYmd,
  minSelectableYmd,
  onSelectDay,
  staffColorAssignments,
}: {
  weekDays: Date[];
  appointments: AppointmentRow[];
  staffById: Map<string, StaffMember>;
  services: MiniSvc[];
  i18n: i18n;
  selectedDayYmd: string;
  minSelectableYmd: string;
  onSelectDay: (d: Date) => void;
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
}) {
  const svcName = (id: string) => services.find((s) => String(s.id) === String(id))?.name || "—";

  return (
    <div className="-mx-1 overflow-x-auto pb-1 sm:mx-0">
      <div className="grid min-w-[52rem] grid-cols-7 gap-2 sm:min-w-[60rem] sm:gap-3 md:min-w-0 md:max-w-none">
        {weekDays.map((d) => {
          const list = apptsForDay(appointments, d);
          const ymd = salonYmdFromAnyDate(d);
          const sel = ymd === selectedDayYmd;
          const disabled = compareSalonYmd(ymd, minSelectableYmd) < 0;
          return (
            <div
              key={d.toISOString()}
              className={`flex min-h-[12rem] flex-col rounded-xl border p-2 sm:min-h-[14rem] sm:p-2.5 md:min-h-[16rem] md:p-3 ${
                sel ? "border-sky-500/70 bg-sky-950/25 ring-1 ring-sky-500/30" : "border-zinc-800 bg-zinc-950/50"
              } ${disabled ? "opacity-45" : ""}`}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onSelectDay(d);
                }}
                className={`mb-2 w-full rounded-lg px-1.5 py-1 text-left text-xs font-semibold tracking-tight sm:text-sm ${
                  disabled
                    ? "cursor-not-allowed text-zinc-600"
                    : sel
                      ? "text-sky-100"
                      : "text-zinc-200 hover:bg-zinc-800/90"
                }`}
              >
                {format(d, "EEE d", { locale: undefined })}
              </button>
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
                {list.map((ap) => {
                  const look = resolveStaffPublicCalendarLook(ap.staff_id, staffById, staffColorAssignments);
                  const master = staffById.get(ap.staff_id);
                  const start = new Date(ap.start_time);
                  const firstName = master?.name?.split(" ")[0] || "—";
                  const paletteStrip = look.kind === "palette" ? look.palette.strip : "";
                  return (
                    <div
                      key={ap.id}
                      title={`${master?.name} · ${svcName(String(ap.service_id))}`}
                      className={`rounded-lg border border-zinc-700/70 bg-zinc-900/95 py-2 pl-0 pr-2 text-left text-xs leading-snug text-zinc-100 shadow-sm sm:text-[13px] sm:leading-snug ${paletteStrip}`}
                      style={
                        look.kind === "google"
                          ? {
                              backgroundColor: look.soft,
                              borderColor: "rgba(63, 63, 70, 0.65)",
                              borderLeftWidth: 4,
                              borderLeftStyle: "solid",
                              borderLeftColor: look.bg,
                              color: "#fafafa",
                            }
                          : undefined
                      }
                    >
                      <div className="min-w-0 pl-2">
                        <div className="font-semibold tabular-nums text-white">
                          {start.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div className="mt-0.5 break-words font-medium text-zinc-100">{firstName}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarStaffLegend({
  appointmentStaffIds,
  staffById,
  staffColorAssignments,
}: {
  appointmentStaffIds: string[];
  staffById: Map<string, StaffMember>;
  staffColorAssignments: ReadonlyMap<string, StaffCalendarColor>;
}) {
  const uniq = [...new Set(appointmentStaffIds)];
  if (uniq.length === 0) return null;
  const byName = [...uniq].sort((a, b) =>
    (staffById.get(a)?.name || a).localeCompare(staffById.get(b)?.name || b, "et", {
      sensitivity: "base",
    }),
  );
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800/80 pt-4">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Мастера</span>
      {byName.map((id) => {
        const m = staffById.get(id);
        const look = resolveStaffPublicCalendarLook(id, staffById, staffColorAssignments);
        return (
          <span key={id} className="flex items-center gap-2 text-sm text-zinc-300">
            {look.kind === "google" ? (
              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-600/80" style={{ backgroundColor: look.bg }} />
            ) : (
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-zinc-600/80 ${look.palette.dot}`} />
            )}
            {m?.name || id.slice(0, 6)}
          </span>
        );
      })}
    </div>
  );
}
