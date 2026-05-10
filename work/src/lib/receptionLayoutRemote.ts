import { type ReceptionRows, normalizeReceptionRows } from "./receptionLayout";
import { supabase } from "./supabase";

export const RECEPTION_SECTION_ORDER_SETTING_KEY = "reception_section_order";

export async function fetchReceptionLayoutFromServer(): Promise<ReceptionRows | null> {
  const { data, error } = await supabase
    .from("salon_settings")
    .select("value")
    .eq("key", RECEPTION_SECTION_ORDER_SETTING_KEY)
    .maybeSingle();
  if (error || !data || data.value == null || String(data.value).trim() === "") return null;
  try {
    return normalizeReceptionRows(JSON.parse(String(data.value)) as unknown);
  } catch {
    return null;
  }
}

export async function saveReceptionLayoutToServer(
  rows: ReceptionRows,
): Promise<{ error: string | null }> {
  const payload = { rows };
  const { error } = await supabase.from("salon_settings").upsert(
    { key: RECEPTION_SECTION_ORDER_SETTING_KEY, value: JSON.stringify(payload) },
    { onConflict: "key" },
  );
  return { error: error?.message ?? null };
}
