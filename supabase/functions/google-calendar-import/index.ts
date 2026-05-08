// supabase/functions/google-calendar-import/index.ts
// ----------------------------------------------------------------------------
// One-click historical import from salon Google Calendar into CRM.
// Designed for CRM tablet usage:
//   1) dryRun=true  -> preview only
//   2) dryRun=false -> writes appointments + appointment_services + link table
//
// Deploy:
//   supabase functions deploy google-calendar-import --no-verify-jwt
//
// Required secrets:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Optional:
//   GOOGLE_CALENDAR_ID=primary
//   GOOGLE_IMPORT_SERVICE_ID=<uuid from service_listings>
//   GOOGLE_IMPORT_STAFF_ID=<uuid from staff>
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_REFRESH_TOKEN = Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "";
const DEFAULT_CALENDAR_ID = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "primary";
const FORCED_SERVICE_ID = Deno.env.get("GOOGLE_IMPORT_SERVICE_ID") ?? "";
const FORCED_STAFF_ID = Deno.env.get("GOOGLE_IMPORT_STAFF_ID") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function asDate(value: string): Date {
  return new Date(value);
}

function parseGoogleDateTime(value: Record<string, unknown> | null): Date | null {
  if (!value) return null;
  const dateTime = typeof value.dateTime === "string" ? value.dateTime : null;
  const date = typeof value.date === "string" ? value.date : null;
  if (dateTime) return asDate(dateTime);
  if (date) return asDate(`${date}T00:00:00.000Z`);
  return null;
}

async function refreshAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json?.access_token) {
    throw new Error(`Google token refresh failed (${res.status})`);
  }
  return String(json.access_token);
}

async function fetchEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string) {
  const out: Array<Record<string, unknown>> = [];
  let pageToken: string | null = null;
  do {
    const qs = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "true",
      maxResults: "2500",
      timeMin,
      timeMax,
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Google events fetch failed (${res.status})`);
    }
    for (const e of (json.items ?? []) as Array<Record<string, unknown>>) out.push(e);
    pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : null;
  } while (pageToken);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing Supabase env");
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
      throw new Error("Missing Google OAuth env");
    }
    const payload = (await req.json().catch(() => ({}))) as {
      dryRun?: boolean;
      from?: string;
      to?: string;
      calendarId?: string;
    };

    const dryRun = payload.dryRun !== false;
    const from = String(payload.from || "2026-01-01");
    const to = String(payload.to || new Date().toISOString().slice(0, 10));
    const calendarId = String(payload.calendarId || DEFAULT_CALENDAR_ID || "primary");

    const timeMin = new Date(`${from}T00:00:00.000Z`).toISOString();
    const timeMax = new Date(`${to}T23:59:59.999Z`).toISOString();

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const accessToken = await refreshAccessToken();
    const events = await fetchEvents(accessToken, calendarId, timeMin, timeMax);

    const counters = {
      total: events.length,
      skippedCancelled: 0,
      skippedNoTime: 0,
      skippedAlreadyLinked: 0,
      skippedNoStaff: 0,
      inserted: 0,
      failed: 0,
      mode: dryRun ? "dry-run" : "apply",
      from,
      to,
      calendarId,
    };

    const { data: staffRows, error: staffErr } = await sb
      .from("staff")
      .select("id,calendar_email")
      .eq("is_active", true);
    if (staffErr) throw new Error(staffErr.message);
    const staff = (staffRows ?? []).map((r) => ({
      id: String(r.id),
      email: r.calendar_email ? String(r.calendar_email).trim().toLowerCase() : "",
    }));
    if (!staff.length) throw new Error("No active staff in DB");

    let serviceId = FORCED_SERVICE_ID || "";
    if (!serviceId) {
      const { data: sRows, error: sErr } = await sb
        .from("service_listings")
        .select("id")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      if (sErr) throw new Error(sErr.message);
      if (!sRows?.length) throw new Error("No active service_listings");
      serviceId = String(sRows[0].id);
    }

    for (const event of events) {
      try {
        const eventId = String(event.id || "");
        if (!eventId) continue;
        if (String(event.status || "").toLowerCase() === "cancelled") {
          counters.skippedCancelled++;
          continue;
        }
        const start = parseGoogleDateTime((event.start as Record<string, unknown>) ?? null);
        let end = parseGoogleDateTime((event.end as Record<string, unknown>) ?? null);
        if (!start || Number.isNaN(start.getTime())) {
          counters.skippedNoTime++;
          continue;
        }
        if (!end || Number.isNaN(end.getTime()) || end <= start) {
          end = new Date(start.getTime() + 60 * 60 * 1000);
        }
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        const { data: link, error: linkErr } = await sb
          .from("google_calendar_event_links")
          .select("appointment_id")
          .eq("provider", "google")
          .eq("calendar_scope", "salon")
          .eq("google_calendar_id", calendarId)
          .eq("google_event_id", eventId)
          .maybeSingle();
        if (linkErr) throw new Error(linkErr.message);
        if (link?.appointment_id) {
          counters.skippedAlreadyLinked++;
          continue;
        }

        const attendees = Array.isArray(event.attendees)
          ? (event.attendees as Array<Record<string, unknown>>)
          : [];
        let staffId = FORCED_STAFF_ID || "";
        if (!staffId) {
          for (const a of attendees) {
            const email = String(a.email || "").trim().toLowerCase();
            const matched = staff.find((s) => s.email && s.email === email);
            if (matched) {
              staffId = matched.id;
              break;
            }
          }
        }
        if (!staffId) {
          for (const s of staff) {
            const { data: busyRows, error: busyErr } = await sb
              .from("appointments")
              .select("id")
              .eq("staff_id", s.id)
              .neq("status", "cancelled")
              .lt("start_time", endIso)
              .gt("end_time", startIso)
              .limit(1);
            if (busyErr) throw new Error(busyErr.message);
            if (!busyRows?.length) {
              staffId = s.id;
              break;
            }
          }
        }
        if (!staffId) {
          counters.skippedNoStaff++;
          continue;
        }

        if (dryRun) {
          counters.inserted++;
          continue;
        }

        const summary = String(event.summary || "").trim() || "Google Calendar client";
        const note = [
          "Imported from Google Calendar (salon mail).",
          event.htmlLink ? `Google link: ${String(event.htmlLink)}` : null,
        ].filter(Boolean).join("\n");

        const { data: insAppt, error: apptErr } = await sb
          .from("appointments")
          .insert({
            staff_id: staffId,
            service_id: serviceId,
            client_name: summary,
            client_phone: null,
            start_time: startIso,
            end_time: endIso,
            status: "confirmed",
            source: "crm",
            note,
          })
          .select("id")
          .limit(1);
        if (apptErr) throw new Error(apptErr.message);
        const appointmentId = String(insAppt?.[0]?.id || "");
        if (!appointmentId) throw new Error("Missing appointment id");

        const { error: lineErr } = await sb.from("appointment_services").insert({
          appointment_id: appointmentId,
          service_id: serviceId,
          staff_id: staffId,
          start_time: startIso,
          end_time: endIso,
        });
        if (lineErr) throw new Error(lineErr.message);

        const { error: upErr } = await sb
          .from("google_calendar_event_links")
          .upsert(
            {
              provider: "google",
              calendar_scope: "salon",
              google_calendar_id: calendarId,
              google_event_id: eventId,
              google_event_status: String(event.status || ""),
              google_event_updated_at: event.updated ? String(event.updated) : null,
              google_event_etag: event.etag ? String(event.etag) : null,
              appointment_id: appointmentId,
              raw_event: event,
            },
            { onConflict: "provider,calendar_scope,google_calendar_id,google_event_id" },
          );
        if (upErr) throw new Error(upErr.message);

        counters.inserted++;
      } catch (_e) {
        counters.failed++;
      }
    }

    return new Response(JSON.stringify(counters), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }
});
