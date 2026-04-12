"use strict";

/**
 * Optional Supabase admin client (service role). Use when migrating reads/writes off SQLite.
 * Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Schema: see supabase/migrations/.
 */
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require("@supabase/supabase-js");
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

module.exports = { getSupabaseAdmin };
