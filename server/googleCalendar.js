"use strict";

/**
 * Google Calendar: OAuth и синхронизация — расширение под GOOGLE_CLIENT_ID / SECRET.
 * Сохраняйте refresh_token в employees.google_refresh_token (уже есть колонка).
 */
function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

async function pushEventStub(booking) {
  if (!isConfigured()) return { ok: false, reason: "not_configured" };
  return { ok: false, reason: "implement_oauth_and_calendar_api" };
}

module.exports = { isConfigured, pushEventStub };
