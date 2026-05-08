#!/usr/bin/env node
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function getArg(name, fallback = null) {
  const pref = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(pref));
  return match ? match.slice(pref.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(value).trim();
}

function parseGoogleDateTime(value, fallbackToStart = false) {
  if (!value) return null;
  if (value.dateTime) return new Date(value.dateTime);
  if (value.date) {
    // Google all-day event has exclusive end date.
    const base = new Date(`${value.date}T00:00:00.000Z`);
    if (!fallbackToStart && Number.isFinite(base.getTime())) return base;
  }
  return null;
}

async function refreshGoogleAccessToken() {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
  const refreshToken = requiredEnv("GOOGLE_REFRESH_TOKEN");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`Google token refresh failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return String(json.access_token);
}

async function fetchGoogleEvents({ accessToken, calendarId, timeMin, timeMax }) {
  let pageToken = null;
  const events = [];

  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "true",
      maxResults: "2500",
      timeMin,
      timeMax,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Google events fetch failed: ${res.status} ${JSON.stringify(json)}`);
    }
    for (const item of json.items || []) events.push(item);
    pageToken = json.nextPageToken || null;
  } while (pageToken);

  return events;
}

async function pickServiceId(supabase) {
  const forced = process.env.GOOGLE_IMPORT_SERVICE_ID?.trim();
  if (forced) return forced;
  const { data, error } = await supabase
    .from("service_listings")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Failed to fetch service_listings: ${error.message}`);
  if (!data?.length) throw new Error("No active service_listings found; set GOOGLE_IMPORT_SERVICE_ID");
  return String(data[0].id);
}

async function fetchStaffRows(supabase) {
  const { data, error } = await supabase
    .from("staff")
    .select("id,name,is_active,calendar_email")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to fetch staff: ${error.message}`);
  return (data || []).map((r) => ({
    id: String(r.id),
    name: String(r.name || ""),
    calendar_email: r.calendar_email ? String(r.calendar_email).trim().toLowerCase() : null,
  }));
}

function resolveStaffFromAttendees(event, staffRows) {
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  if (!attendees.length) return null;
  const byEmail = new Map();
  for (const s of staffRows) {
    if (s.calendar_email) byEmail.set(s.calendar_email, s);
  }
  for (const a of attendees) {
    const email = String(a?.email || "").trim().toLowerCase();
    if (email && byEmail.has(email)) return byEmail.get(email).id;
  }
  return null;
}

async function pickFreeStaffId(supabase, staffRows, startIso, endIso) {
  for (const s of staffRows) {
    const { data, error } = await supabase
      .from("appointments")
      .select("id")
      .eq("staff_id", s.id)
      .neq("status", "cancelled")
      .lt("start_time", endIso)
      .gt("end_time", startIso)
      .limit(1);
    if (error) throw new Error(`Failed to check overlap for staff ${s.id}: ${error.message}`);
    if (!data?.length) return s.id;
  }
  return null;
}

async function main() {
  const isDryRun = hasFlag("dry-run");
  const fromArg = getArg("from");
  const toArg = getArg("to");
  const calendarId = (getArg("calendar-id") || process.env.GOOGLE_CALENDAR_ID || "primary").trim();

  if (!fromArg || !toArg) {
    throw new Error("Usage: node scripts/import-google-calendar.mjs --from=2020-01-01 --to=2026-12-31 [--dry-run] [--calendar-id=...]");
  }
  const fromIso = new Date(`${fromArg}T00:00:00.000Z`).toISOString();
  const toIso = new Date(`${toArg}T23:59:59.999Z`).toISOString();

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseServiceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  const accessToken = await refreshGoogleAccessToken();
  const events = await fetchGoogleEvents({
    accessToken,
    calendarId,
    timeMin: fromIso,
    timeMax: toIso,
  });

  const serviceId = await pickServiceId(supabase);
  const forcedStaffId = process.env.GOOGLE_IMPORT_STAFF_ID?.trim() || null;
  const staffRows = await fetchStaffRows(supabase);
  if (!staffRows.length) throw new Error("No active staff found in CRM");

  const counters = {
    total: events.length,
    skippedCancelled: 0,
    skippedNoTime: 0,
    skippedAlreadyLinked: 0,
    skippedNoStaff: 0,
    inserted: 0,
    linkedOnly: 0,
    failed: 0,
  };

  console.log(`Google events fetched: ${events.length}`);
  console.log(`Mode: ${isDryRun ? "DRY-RUN" : "IMPORT"}`);
  console.log(`Calendar: ${calendarId}`);
  console.log(`Range: ${fromIso} .. ${toIso}`);

  for (const event of events) {
    try {
      const eventId = String(event?.id || "").trim();
      if (!eventId) continue;
      if (String(event?.status || "").toLowerCase() === "cancelled") {
        counters.skippedCancelled++;
        continue;
      }

      const start = parseGoogleDateTime(event.start, true);
      let end = parseGoogleDateTime(event.end, false);
      if (!start || !Number.isFinite(start.getTime())) {
        counters.skippedNoTime++;
        continue;
      }
      if (!end || !Number.isFinite(end.getTime()) || end <= start) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
      }

      const { data: linkRow, error: linkErr } = await supabase
        .from("google_calendar_event_links")
        .select("id,appointment_id")
        .eq("provider", "google")
        .eq("calendar_scope", "salon")
        .eq("google_calendar_id", calendarId)
        .eq("google_event_id", eventId)
        .maybeSingle();
      if (linkErr) throw new Error(`Link lookup failed: ${linkErr.message}`);
      if (linkRow?.appointment_id) {
        counters.skippedAlreadyLinked++;
        continue;
      }

      const startIso = start.toISOString();
      const endIso = end.toISOString();

      let staffId =
        forcedStaffId ||
        resolveStaffFromAttendees(event, staffRows) ||
        (await pickFreeStaffId(supabase, staffRows, startIso, endIso));

      if (!staffId) {
        counters.skippedNoStaff++;
        continue;
      }

      const summary = String(event.summary || "").trim();
      const noteParts = [
        "Imported from Google Calendar (salon mail).",
        event.htmlLink ? `Google link: ${event.htmlLink}` : null,
        event.description ? `Description: ${String(event.description).slice(0, 1500)}` : null,
      ].filter(Boolean);
      const payload = {
        staff_id: staffId,
        service_id: serviceId,
        client_name: summary || "Google Calendar client",
        client_phone: null,
        start_time: startIso,
        end_time: endIso,
        status: "confirmed",
        source: "crm",
        note: noteParts.join("\n"),
      };

      if (isDryRun) {
        counters.inserted++;
        continue;
      }

      const { data: insRows, error: insErr } = await supabase
        .from("appointments")
        .insert(payload)
        .select("id")
        .limit(1);
      if (insErr) throw new Error(`Appointment insert failed: ${insErr.message}`);
      const appointmentId = insRows?.[0]?.id;
      if (!appointmentId) throw new Error("Appointment insert returned no id");

      const { error: linesErr } = await supabase.from("appointment_services").insert({
        appointment_id: appointmentId,
        service_id: serviceId,
        staff_id: staffId,
        start_time: startIso,
        end_time: endIso,
      });
      if (linesErr) throw new Error(`appointment_services insert failed: ${linesErr.message}`);

      const linkPayload = {
        provider: "google",
        calendar_scope: "salon",
        google_calendar_id: calendarId,
        google_event_id: eventId,
        google_event_status: String(event.status || ""),
        google_event_updated_at: event.updated || null,
        google_event_etag: event.etag || null,
        appointment_id: appointmentId,
        raw_event: event,
      };
      const { error: upErr } = await supabase
        .from("google_calendar_event_links")
        .upsert(linkPayload, {
          onConflict: "provider,calendar_scope,google_calendar_id,google_event_id",
        });
      if (upErr) throw new Error(`Link upsert failed: ${upErr.message}`);

      counters.inserted++;
    } catch (e) {
      counters.failed++;
      console.error(`[IMPORT_ERROR] ${(e && e.message) || e}`);
    }
  }

  console.log("---- Import summary ----");
  console.log(JSON.stringify(counters, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
