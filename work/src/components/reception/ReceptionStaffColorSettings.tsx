import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import type { StaffMember } from "../../types/database";
import { buildStaffHueMap } from "../../lib/staffHue";
import { googleStaffColor } from "./receptionColors";
import { ReceptionCustomColorPicker } from "./ReceptionCustomColorPicker";

const HEX6 = /^#[0-9a-f]{6}$/i;

// 24-color Google Calendar palette (6 × 4)
const GCAL_COLORS = [
  // row 1 — dark
  { key: "berry",       hex: "#880e4f" },
  { key: "tangerineDk", hex: "#bf360c" },
  { key: "banana",      hex: "#f6bf26" },
  { key: "basil",       hex: "#1b5e20" },
  { key: "blueberryDk", hex: "#1a237e" },
  { key: "grapeDk",     hex: "#4a148c" },
  // row 2 — medium
  { key: "flamingo",    hex: "#d81b60" },
  { key: "tangerine",   hex: "#e64a19" },
  { key: "chartreuse",  hex: "#c6ca53" },
  { key: "sage",        hex: "#33b679" },
  { key: "lavender",    hex: "#7986cb" },
  { key: "cocoa",       hex: "#795548" },
  // row 3 — standard
  { key: "tomato",      hex: "#d50000" },
  { key: "amber",       hex: "#f09300" },
  { key: "lime",        hex: "#7cb342" },
  { key: "peacock",     hex: "#039be5" },
  { key: "wisteria",    hex: "#b39ddb" },
  { key: "graphite",    hex: "#616161" },
  // row 4 — light
  { key: "blush",       hex: "#e8a09a" },
  { key: "cream",       hex: "#fdd663" },
  { key: "mint",        hex: "#57bb8a" },
  { key: "sky",         hex: "#4285f4" },
  { key: "lilac",       hex: "#bab3e8" },
  { key: "sand",        hex: "#bcaaa4" },
];

type Props = {
  staff: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
};

type CustomPickerState = { staffId: string; staffName: string; hex: string } | null;

export function ReceptionStaffColorSettings({ staff, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [customPicker, setCustomPicker] = useState<CustomPickerState>(null);
  const staffHueMap = buildStaffHueMap(staff.map((m) => m.id));

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !customPicker) onClose(); }
    function onDown(e: MouseEvent) {
      if (!customPicker && panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, customPicker]);

  async function handleColorPick(staffId: string, hex: string) {
    setSaving(staffId);
    await supabase.from("staff").update({ calendar_color_hex: hex }).eq("id", staffId);
    setSaving(null);
    onSaved();
  }

  async function handleCustomSave(hex: string) {
    if (customPicker) {
      await handleColorPick(customPicker.staffId, hex);
    }
    setCustomPicker(null);
  }

  return (
    <>
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
              const currentHex = member.calendar_color_hex?.toLowerCase();
              const isCustom = currentHex && HEX6.test(currentHex) &&
                !GCAL_COLORS.some((col) => col.hex === currentHex);
              return (
                <div key={member.id} className="py-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: c.bg }} />
                    <span className="text-sm font-medium text-[#3c4043]">
                      {member.name}
                      {isSavingThis && (
                        <span className="ml-1 text-xs text-[#70757a]">{t("modal.saving")}</span>
                      )}
                    </span>
                  </div>

                  {/* 6-column grid */}
                  <div className="grid grid-cols-6 gap-1.5">
                    {GCAL_COLORS.map((col) => {
                      const isActive = currentHex === col.hex;
                      return (
                        <button
                          key={col.hex}
                          title={t(`reception.colorNames.${col.key}`)}
                          onClick={() => void handleColorPick(member.id, col.hex)}
                          className="relative h-8 w-8 rounded-full transition-transform hover:scale-110"
                          style={{ backgroundColor: col.hex }}
                        >
                          {isActive && (
                            <svg viewBox="0 0 20 20" className="absolute inset-0 h-full w-full" fill="none">
                              <polyline points="5,10 8.5,13.5 15,7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}

                    {/* Custom "+" button */}
                    <button
                      title={t("reception.colorNames.custom")}
                      onClick={() => setCustomPicker({ staffId: member.id, staffName: member.name, hex: currentHex && HEX6.test(currentHex) ? currentHex : "#7986cb" })}
                      className="relative h-8 w-8 overflow-hidden rounded-full transition-transform hover:scale-110"
                      style={
                        isCustom
                          ? { backgroundColor: currentHex }
                          : { background: "#f1f3f4", border: "1.5px solid #dadce0" }
                      }
                    >
                      {isCustom ? (
                        <svg viewBox="0 0 20 20" className="absolute inset-0 h-full w-full" fill="none">
                          <polyline points="5,10 8.5,13.5 15,7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-base font-light text-[#5f6368]">+</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Custom colour picker modal */}
      {customPicker && (
        <ReceptionCustomColorPicker
          staffName={customPicker.staffName}
          initialHex={customPicker.hex}
          onSave={(hex) => void handleCustomSave(hex)}
          onCancel={() => setCustomPicker(null)}
        />
      )}
    </>
  );
}
