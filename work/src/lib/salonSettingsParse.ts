import type { SupabaseClient } from "@supabase/supabase-js";

/** Строковые значения в `salon_settings.value` → boolean. */

export function parseSalonBoolSetting(v: string | null | undefined, fallback = true): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

export const SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED = "public_booking_panel_enabled" as const;

/**
 * Включена ли публичная панель записи. Сначала RPC (обход RLS), при ошибке — прямое чтение
 * `salon_settings`, если политика 070 позволяет anon читать ключ.
 */
export async function fetchPublicBookingPanelEnabled(client: SupabaseClient): Promise<boolean> {
  const { data: rpcData, error: rpcErr } = await client.rpc("public_site_booking_panel_enabled");
  if (!rpcErr && typeof rpcData === "boolean") {
    return rpcData;
  }
  if (!rpcErr && rpcData != null && rpcData !== "") {
    return parseSalonBoolSetting(String(rpcData), true);
  }
  const { data: row, error: rowErr } = await client
    .from("salon_settings")
    .select("value")
    .eq("key", SALON_SETTING_PUBLIC_BOOKING_PANEL_ENABLED)
    .maybeSingle();
  if (!rowErr && row?.value != null) {
    return parseSalonBoolSetting(String(row.value), true);
  }
  return true;
}
