/**
 * Copy to supabase-public-config.js and fill anonKey.
 * Or inject a script BEFORE supabase-public-config.js with window.SUPABASE_CONFIG.
 */
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_ANON_KEY",
};
window.SALON_SUPABASE_URL = window.SUPABASE_CONFIG.url;
window.SALON_SUPABASE_ANON_KEY = window.SUPABASE_CONFIG.anonKey;
