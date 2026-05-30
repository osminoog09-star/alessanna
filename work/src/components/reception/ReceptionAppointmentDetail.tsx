import { useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import type { AppointmentRow, ServiceRow, StaffMember } from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { googleStaffColor } from "./receptionColors";

type Props = {
  appt: AppointmentRow;
  anchorX: number;
  anchorY: number;
  staff: StaffMember[];
  services: ServiceRow[];
  onClose: () => void;
};

const POPUP_W = 300;
const POPUP_H = 220;

export function ReceptionAppointmentDetail({
  appt,
  anchorX,
  anchorY,
  staff,
  services,
  onClose,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  const left = Math.min(anchorX + 12, window.innerWidth - POPUP_W - 8);
  const top = Math.max(8, Math.min(anchorY - 8, window.innerHeight - POPUP_H - 8));

  const member = staff.find((s) => s.id === appt.staff_id);
  const svc = services.find((s) => String(s.id) === String(appt.service_id));
  const c = member
    ? googleStaffColor(member, staffHueMap)
    : { bg: "#7986cb", fg: "#ffffff", border: "#5c6bc0" };

  const startDt = parseISO(appt.start_time);
  const endDt = parseISO(appt.end_time);
  const timeLabel = `${format(startDt, "HH:mm")} – ${format(endDt, "HH:mm")}`;
  const dateLabel = startDt.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      style={{ left, top, width: POPUP_W }}
      className="fixed z-50 overflow-hidden rounded-xl border border-[#dadce0] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
      role="dialog"
    >
      {/* Colored accent header */}
      <div
        className="px-4 py-3"
        style={{ backgroundColor: c.bg, color: c.fg }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-tight">{appt.client_name}</p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-0.5 opacity-80 hover:opacity-100"
            style={{ color: c.fg }}
            aria-label="Закрыть"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-2.5 p-4">
        {/* Time */}
        <div className="flex items-start gap-3">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[#5f6368]" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium capitalize text-[#3c4043]">{dateLabel}</p>
            <p className="text-sm text-[#70757a]">{timeLabel}</p>
          </div>
        </div>

        {/* Staff */}
        {member && (
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#5f6368]" fill="currentColor">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-[#3c4043]">{member.name}</span>
          </div>
        )}

        {/* Service */}
        {svc && (
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#5f6368]" fill="currentColor">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-[#3c4043]">
              {svc.name_et}
              <span className="ml-1 text-[#70757a]">· {svc.duration_min} мин</span>
            </span>
          </div>
        )}

        {/* Phone */}
        {appt.client_phone && (
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[#5f6368]" fill="currentColor">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            <span className="text-sm text-[#3c4043]">{appt.client_phone}</span>
          </div>
        )}
      </div>
    </div>
  );
}
