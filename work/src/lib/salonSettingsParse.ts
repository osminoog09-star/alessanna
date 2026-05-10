/** Строковые значения в `salon_settings.value` → boolean. */

export function parseSalonBoolSetting(v: string | null | undefined, fallback = true): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

export const SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED = "public_booking_panel_enabled" as const;
