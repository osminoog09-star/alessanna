import type { StaffMember } from "../../types/database";

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Относительная яркость hex-цвета (0..1) для выбора читаемого текста. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const lin = (x: number) => {
    const u = x / 255;
    return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * lin(parseInt(m[1], 16)) +
    0.7152 * lin(parseInt(m[2], 16)) +
    0.0722 * lin(parseInt(m[3], 16))
  );
}

export type GoogleColor = { bg: string; fg: string; border: string };

/**
 * Цвет мастера 1-в-1 как в Google Calendar: используем синхронизированный
 * calendar_color_hex напрямую (без opacity-трансформаций), текст подбираем
 * по яркости фона. Fallback — стабильный HSL по hue-карте.
 */
export function googleStaffColor(
  member: Pick<StaffMember, "id" | "calendar_color_hex" | "calendar_foreground_hex">,
  hueMap: Map<string, number>,
): GoogleColor {
  const hex = member.calendar_color_hex?.trim();
  if (hex && HEX6.test(hex)) {
    const fgHex = member.calendar_foreground_hex?.trim();
    const fg =
      fgHex && HEX6.test(fgHex)
        ? fgHex
        : luminance(hex) > 0.6
        ? "#3c4043"
        : "#ffffff";
    return { bg: hex, fg, border: hex };
  }
  const hue = hueMap.get(member.id) ?? 210;
  return { bg: `hsl(${hue}, 70%, 55%)`, fg: "#ffffff", border: `hsl(${hue}, 70%, 45%)` };
}
