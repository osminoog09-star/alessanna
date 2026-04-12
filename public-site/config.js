/**
 * @deprecated Use repo-root `supabase-public-config.js` (window.SUPABASE_CONFIG).
 * Kept for old bookmarks that only load public-site/config.js — set keys here if you do not use ../supabase-public-config.js.
 */
(function () {
  var preset = window.SUPABASE_CONFIG || {};
  window.SUPABASE_CONFIG = {
    url: String(preset.url || window.SALON_SUPABASE_URL || "").replace(/\/+$/, ""),
    anonKey: preset.anonKey != null ? String(preset.anonKey) : String(window.SALON_SUPABASE_ANON_KEY || ""),
  };
  window.SALON_SUPABASE_URL = window.SALON_SUPABASE_URL || window.SUPABASE_CONFIG.url;
  window.SALON_SUPABASE_ANON_KEY = window.SALON_SUPABASE_ANON_KEY || window.SUPABASE_CONFIG.anonKey;
})();
