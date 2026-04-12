import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

function looksConfigured(u: string, k: string): boolean {
  if (!u.startsWith("http") || !k) return false;
  const ul = u.toLowerCase();
  const kl = k.toLowerCase();
  if (ul.includes("your_url") || ul.includes("your_project")) return false;
  if (kl.includes("your_key") || kl.includes("your_anon")) return false;
  return true;
}

const configured = looksConfigured(url, key);

if (import.meta.env.DEV && !configured) {
  console.warn(
    "[CRM] Set VITE_SUPABASE_URL (https://….supabase.co) and VITE_SUPABASE_ANON_KEY in work/.env or Vercel env vars."
  );
}

export const supabase = createClient(configured ? url : "https://placeholder.supabase.co", configured ? key : "placeholder", {
  auth: { persistSession: false },
});

export function isSupabaseConfigured(): boolean {
  return configured;
}
