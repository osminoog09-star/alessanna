import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

function isConfigured(u: string, k: string): boolean {
  if (!u || !k) return false;
  if (!u.startsWith("http")) return false;
  const uL = u.toLowerCase();
  const kL = k.toLowerCase();
  if (uL.includes("your_project") || uL.includes("your_url") || uL === "https://placeholder.supabase.co") {
    return false;
  }
  if (kL.includes("your_anon") || kL.includes("your_key") || k === "placeholder" || k === "invalid-placeholder-key") {
    return false;
  }
  return true;
}

const configured = isConfigured(url, key);

if (import.meta.env.DEV && !configured) {
  console.warn(
    "[CRM] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in work/.env. Vite inlines them at build time."
  );
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

export default supabase;

export function isSupabaseConfigured(): boolean {
  return configured;
}
