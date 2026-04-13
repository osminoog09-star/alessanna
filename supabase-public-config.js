/**
 * Public marketing site + public-site/book — load before any module bundle.
 * Plain script: no import.meta (use site-services.mjs / book.js for VITE_* fallback when bundled).
 *
 * Set anonKey here for static hosting, or inject another script BEFORE this one:
 *   window.SUPABASE_CONFIG = { url: "…", anonKey: "…" };
 */
(function () {
  var preset = window.SUPABASE_CONFIG || {};
  window.SUPABASE_CONFIG = {
    url: String(preset.url || "https://eclrkusmwcrtnxqhzpky.supabase.co").replace(/\/+$/, ""),
    anonKey:
      preset.anonKey != null
        ? String(preset.anonKey)
        : "sb_publishable_tA3Pcv44d9PutcYqP_dYCQ_SEhjXr4D",
  };
  window.SALON_SUPABASE_URL = window.SALON_SUPABASE_URL || window.SUPABASE_CONFIG.url;
  window.SALON_SUPABASE_ANON_KEY = window.SALON_SUPABASE_ANON_KEY || window.SUPABASE_CONFIG.anonKey;
})();
