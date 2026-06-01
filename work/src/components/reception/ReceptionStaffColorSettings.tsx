import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import type { StaffMember } from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { googleStaffColor } from "./receptionColors";

const GCAL_COLORS = [
  { key: "tomato",     hex: "#d50000" },
  { key: "flamingo",   hex: "#e67c73" },
  { key: "tangerine",  hex: "#f4511e" },
  { key: "banana",     hex: "#f6bf26" },
  { key: "sage",       hex: "#33b679" },
  { key: "basil",      hex: "#0b8043" },
  { key: "peacock",    hex: "#039be5" },
  { key: "blueberry",  hex: "#3f51b5" },
  { key: "lavender",   hex: "#7986cb" },
  { key: "grape",      hex: "#8e24aa" },
  { key: "graphite",   hex: "#616161" },
];

type Props = {
  staff: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
};

export function ReceptionStaffColorSettings({ staff, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  async function handleColorPick(staffId: string, hex: string) {
    setSaving(staffId);
    await supabase.from("staff").update({ calendar_color_hex: hex }).eq("id", staffId);
    setSaving(null);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/20">
      <div
        ref={panelRef}
        className="flex h-full w-80 flex-col overflow-y-auto bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#dadce0] px-4 py-3">
          <span className="text-sm font-semibold text-[#3c4043]">{t("reception.colorSettings")}</span>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Staff list */}
        <div className="flex-1 divide-y divide-[#f1f3f4] px-4 py-2">
          {staff.map((member) => {
            const c = googleStaffColor(member, staffHueMap);
            const isSavingThis = saving === member.id;
            return (
              <div key={member.id} className="py-3">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: c.bg }}
                  />
                  <span className="text-sm font-medium text-[#3c4043]">
                    {member.name}
                    {isSavingThis && (
                      <span className="ml-1 text-xs text-[#70757a]">{t("modal.saving")}</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GCAL_COLORS.map((col) => {
                    const isActive = member.calendar_color_hex?.toLowerCase() === col.hex;
                    return (
                      <button
                        key={col.hex}
                        title={t(`reception.colorNames.${col.key}`)}
                        onClick={() => void handleColorPick(member.id, col.hex)}
                        className="relative h-6 w-6 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: col.hex }}
                      >
                        {isActive && (
                          <svg
                            viewBox="0 0 20 20"
                            className="absolute inset-0 h-full w-full"
                            fill="none"
                          >
                            <polyline
                              points="5,10 8.5,13.5 15,7"
                              stroke="white"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
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
