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

// Heuristic: identify Google "system" calendars that we never want to pull
// into CRM as client appointments (national holidays, birthdays from contacts,
// week numbers, etc.). These are usually subscribed read-only feeds.
function isJunkCalendarId(id: string): boolean {
  const v = id.toLowerCase();
  if (!v) return true;
  // Holiday calendars: "<locale>.<country>#holiday@group.v.calendar.google.com"
  // (e.g. "en.ee#holiday@...", "et.ee#holiday@...", "en.usa#holiday@...").
  if (v.includes("#holiday@group.v.calendar.google.com")) return true;
  // Birthdays from Google Contacts.
  if (v.includes("#contacts@group.v.calendar.google.com")) return true;
  if (v === "addressbook#contacts@group.v.calendar.google.com") return true;
  // Week numbers / other group.v.calendar.google.com feeds.
  if (v.includes("@group.v.calendar.google.com")) return true;
  return false;
}

type CalListEntry = {
  id: string;
  summary?: string;
  backgroundColor?: string;
  foregroundColor?: string;
};

async function fetchCalendarListEntries(accessToken: string): Promise<CalListEntry[]> {
  const out: CalListEntry[] = [];
  let pageToken: string | null = null;
  do {
    const qs = new URLSearchParams();
    qs.set("maxResults", "250");
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Google calendarList fetch failed (${res.status})`);
    for (const item of (json.items ?? []) as Array<Record<string, unknown>>) {
      out.push({
        id: String(item.id || "").trim(),
        summary: typeof item.summary === "string" ? item.summary : undefined,
        backgroundColor: typeof item.backgroundColor === "string" ? item.backgroundColor : undefined,
        foregroundColor: typeof item.foregroundColor === "string" ? item.foregroundColor : undefined,
      });
    }
    pageToken = typeof json.nextPageToken === "string" ? json.nextPageToken : null;
  } while (pageToken);
  return out;
}

function calendarIdsFromList(entries: CalListEntry[]): { ids: string[]; skippedJunk: string[] } {
  const ids: string[] = [];
  const skippedJunk: string[] = [];
  for (const e of entries) {
    if (!e.id) continue;
    if (isJunkCalendarId(e.id)) {
      skippedJunk.push(e.id);
      continue;
    }
    ids.push(e.id);
  }
  return { ids: Array.from(new Set(ids)), skippedJunk: Array.from(new Set(skippedJunk)) };
}

type StaffColorRow = {
  id: string;
  name: string;
  calendar_email: string | null;
  google_calendar_id: string | null;
};

const HEX6 = /^#[0-9a-f]{6}$/i;

function resolveStaffIdForCalendarListEntry(staff: StaffColorRow[], entry: CalListEntry): string | null {
  const calId = entry.id;
  if (!calId) return null;
  const byGid = staff.find((s) => s.google_calendar_id && String(s.google_calendar_id).trim() === calId);
  if (byGid) return byGid.id;
  const calLower = calId.toLowerCase();
  const byEmail = staff.find((s) => {
    const em = s.calendar_email ? String(s.calendar_email).trim().toLowerCase() : "";
    return em && em === calLower;
  });
  if (byEmail) return byEmail.id;
  const summary = (entry.summary || "").trim().toLowerCase();
  if (!summary) return null;
  const nameHits = staff.filter((s) => String(s.name || "").trim().toLowerCase() === summary);
  if (nameHits.length === 1) return nameHits[0]!.id;
  return null;
}

async function syncStaffCalendarColorsFromGoogleList(
  sb: ReturnType<typeof createClient>,
  entries: CalListEntry[],
  staffRows: StaffColorRow[],
  skipDbWrites: boolean,
): Promise<{ staffColorsMatched: number; staffColorsUpdated: number }> {
  let staffColorsMatched = 0;
  let staffColorsUpdated = 0;
  for (const entry of entries) {
    if (!entry.id || isJunkCalendarId(entry.id)) continue;
    const bg = String(entry.backgroundColor || "").trim();
    if (!HEX6.test(bg)) continue;
    const staffId = resolveStaffIdForCalendarListEntry(staffRows, entry);
    if (!staffId) continue;
    staffColorsMatched++;
    const fgRaw = String(entry.foregroundColor || "").trim();
    const fg = HEX6.test(fgRaw) ? fgRaw.toLowerCase() : null;
    if (skipDbWrites) continue;
    const { error } = await sb
      .from("staff")
      .update({
        calendar_color_hex: bg.toLowerCase(),
        calendar_foreground_hex: fg,
      })
      .eq("id", staffId);
    if (!error) staffColorsUpdated++;
  }
  return { staffColorsMatched, staffColorsUpdated };
}

// Event types we never want as CRM appointments. "default" stays.
// Reference: https://developers.google.com/calendar/api/v3/reference/events
const JUNK_EVENT_TYPES = new Set([
  "birthday",
  "fromGmail",
  "workingLocation",
  "focusTime",
  "outOfOffice",
]);

function detectStaffFromAttendeesOrText(
  event: Record<string, unknown>,
  staff: Array<{ id: string; name: string; email: string }>,
): string {
  const attendees = Array.isArray(event.attendees)
    ? (event.attendees as Array<Record<string, unknown>>)
    : [];
  for (const a of attendees) {
    const email = String(a.email || "").trim().toLowerCase();
    const matched = staff.find((s) => s.email && s.email === email);
    if (matched) return matched.id;
  }
  const haystack = `${String(event.summary || "")} ${String(event.description || "")}`.toLowerCase();
  const byName = staff.find((s) => s.name && haystack.includes(s.name));
  return byName?.id || "";
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
      includeAllSelectedCalendars?: boolean;
      /** Только обновить calendar_color_hex у мастеров из Google calendarList (без импорта событий). */
      staffColorsOnly?: boolean;
      /** false — не писать цвета в staff (по умолчанию пишем). */
      syncStaffColors?: boolean;
    };

    const dryRun = payload.dryRun !== false;
    const staffColorsOnly = payload.staffColorsOnly === true;
    const from = String(payload.from || "2026-01-01");
    const to = String(payload.to || new Date().toISOString().slice(0, 10));
    const calendarId = String(payload.calendarId || DEFAULT_CALENDAR_ID || "primary");
    const includeAllSelectedCalendars = payload.includeAllSelectedCalendars !== false;

    const timeMin = new Date(`${from}T00:00:00.000Z`).toISOString();
    const timeMax = new Date(`${to}T23:59:59.999Z`).toISOString();

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const accessToken = await refreshAccessToken();

    const { data: staffRowsRaw, error: staffErr } = await sb
      .from("staff")
      .select("id,name,calendar_email,google_calendar_id")
      .eq("is_active", true);
    if (staffErr) throw new Error(staffErr.message);
    const staffColorRows: StaffColorRow[] = (staffRowsRaw ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name || ""),
      calendar_email: r.calendar_email != null ? String(r.calendar_email) : null,
      google_calendar_id: r.google_calendar_id != null ? String(r.google_calendar_id) : null,
    }));
    if (!staffColorRows.length) throw new Error("No active staff in DB");

    const listEntries = await fetchCalendarListEntries(accessToken);

    if (staffColorsOnly) {
      const colorSync = await syncStaffCalendarColorsFromGoogleList(
        sb,
        listEntries,
        staffColorRows,
        payload.syncStaffColors === false,
      );
      return new Response(
        JSON.stringify({
          staffColorsOnly: true,
          staffColorsMatched: colorSync.staffColorsMatched,
          staffColorsUpdated: colorSync.staffColorsUpdated,
        }),
        { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
      );
    }

    const skipStaffColorWrites = payload.syncStaffColors === false || dryRun;
    const colorSync = await syncStaffCalendarColorsFromGoogleList(
      sb,
      listEntries,
      staffColorRows,
      skipStaffColorWrites,
    );

    const staff = staffColorRows.map((s) => ({
      id: s.id,
      name: s.name.trim().toLowerCase(),
      email: s.calendar_email ? s.calendar_email.trim().toLowerCase() : "",
    }));

    let targetCalendars: string[] = [];
    let skippedJunkCalendars: string[] = [];
    if (includeAllSelectedCalendars) {
      const list = calendarIdsFromList(listEntries);
      targetCalendars = list.ids;
      skippedJunkCalendars = list.skippedJunk;
    } else {
      // Even if a single calendar is targeted explicitly, still respect the
      // junk-calendar heuristic so callers can't accidentally pull holidays.
      if (isJunkCalendarId(calendarId)) {
        skippedJunkCalendars = [calendarId];
      } else {
        targetCalendars = [calendarId];
      }
    }
    if (!targetCalendars.length && !includeAllSelectedCalendars) {
      targetCalendars.push(calendarId);
    }

    const events: Array<Record<string, unknown> & { __calendar_id: string }> = [];
    for (const cid of targetCalendars) {
      const chunk = await fetchEvents(accessToken, cid, timeMin, timeMax);
      for (const e of chunk) events.push({ ...(e as Record<string, unknown>), __calendar_id: cid });
    }

    const counters = {
      total: events.length,
      skippedCancelled: 0,
      skippedNoTime: 0,
      skippedAlreadyLinked: 0,
      skippedEventType: 0,
      forcedStaffFallback: 0,
      inserted: 0,
      failed: 0,
      mode: dryRun ? "dry-run" : "apply",
      from,
      to,
      calendarId: includeAllSelectedCalendars ? "all-selected" : calendarId,
      calendarsScanned: targetCalendars.length,
      skippedJunkCalendars,
      staffColorsMatched: colorSync.staffColorsMatched,
      staffColorsUpdated: colorSync.staffColorsUpdated,
    };

    // Build color->staff mapping from events where staff is explicitly detectable.
    const colorVotes = new Map<string, Map<string, number>>();
    for (const event of events) {
      const colorId = String(event.colorId || "").trim();
      if (!colorId) continue;
      const detectedStaffId = detectStaffFromAttendeesOrText(event, staff);
      if (!detectedStaffId) continue;
      if (!colorVotes.has(colorId)) colorVotes.set(colorId, new Map<string, number>());
      const bucket = colorVotes.get(colorId)!;
      bucket.set(detectedStaffId, (bucket.get(detectedStaffId) ?? 0) + 1);
    }
    const colorToStaff = new Map<string, string>();
    for (const [colorId, bucket] of colorVotes.entries()) {
      let winnerStaffId = "";
      let winnerVotes = -1;
      for (const [staffId, votes] of bucket.entries()) {
        if (votes > winnerVotes) {
          winnerVotes = votes;
          winnerStaffId = staffId;
        }
      }
      if (winnerStaffId) colorToStaff.set(colorId, winnerStaffId);
    }

    let serviceId = FORCED_SERVICE_ID || "";
    let servicePool: Array<{ id: string; name: string }> = [];
    if (!serviceId) {
      const { data: sRows, error: sErr } = await sb
        .from("service_listings")
        .select("id,name")
        .eq("is_active", true)
        .order("id", { ascending: true })
        .limit(300);
      if (sErr) throw new Error(sErr.message);
      if (!sRows?.length) throw new Error("No active service_listings");
      servicePool = sRows.map((r) => ({ id: String(r.id), name: String((r as { name?: string }).name || "") }));
      serviceId = String(servicePool[0].id);
    }

    for (const event of events) {
      try {
        const eventId = String(event.id || "");
        const eventCalendarId = String(event.__calendar_id || calendarId);
        if (!eventId) continue;
        const eventType = String(event.eventType || "").trim();
        if (eventType && JUNK_EVENT_TYPES.has(eventType)) {
          counters.skippedEventType++;
          continue;
        }
        const googleStatus = String(event.status || "").toLowerCase();
        const startRaw = (event.start as Record<string, unknown>) ?? null;
        const start = parseGoogleDateTime(startRaw);
        let end = parseGoogleDateTime((event.end as Record<string, unknown>) ?? null);
        if (!start || Number.isNaN(start.getTime())) {
          counters.skippedNoTime++;
          continue;
        }
        // All-day events (date only, no dateTime) are almost never real client
        // appointments — they are typically holidays, name-days, vacations,
        // birthdays, etc. Salon bookings always have a concrete time. Skip
        // them as a safety net even if the calendar itself wasn't filtered.
        const hasDateTime = !!(startRaw && typeof startRaw.dateTime === "string");
        if (!hasDateTime) {
          counters.skippedEventType++;
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
          .eq("google_calendar_id", eventCalendarId)
          .eq("google_event_id", eventId)
          .maybeSingle();
        if (linkErr) throw new Error(linkErr.message);
        if (link?.appointment_id) {
          counters.skippedAlreadyLinked++;
          continue;
        }

        const colorId = String(event.colorId || "").trim();
        let staffId = FORCED_STAFF_ID || "";
        if (!staffId) staffId = detectStaffFromAttendeesOrText(event, staff);
        if (!staffId && colorId && colorToStaff.has(colorId)) {
          staffId = colorToStaff.get(colorId) || "";
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
        const wasStaffResolved = !!staffId;
        if (!staffId) staffId = FORCED_STAFF_ID || staff[0]?.id || "";
        if (!staffId) throw new Error("No fallback staff id");
        if (!wasStaffResolved) counters.forcedStaffFallback++;

        if (dryRun) {
          counters.inserted++;
          continue;
        }

        const summary = String(event.summary || "").trim() || "Google Calendar client";
        let resolvedServiceId = serviceId;
        if (servicePool.length > 0) {
          const haystack = `${summary} ${String(event.description || "")}`.toLowerCase();
          const byName = servicePool.find((s) => {
            const n = s.name.trim().toLowerCase();
            return n.length >= 4 && haystack.includes(n);
          });
          if (byName) resolvedServiceId = byName.id;
        }
        const eventDescription = String(event.description || "").trim();
        const eventLocation = String(event.location || "").trim();
        const eventColorId = String(event.colorId || "").trim();
        const attendees = Array.isArray(event.attendees)
          ? (event.attendees as Array<Record<string, unknown>>)
          : [];
        const attendeeEmails = attendees
          .map((a) => String(a.email || "").trim())
          .filter(Boolean);

        const note = [
          "Imported from Google Calendar (salon mail).",
          wasStaffResolved ? null : "Master was not detected automatically. Assigned by fallback.",
          eventColorId ? `Google colorId: ${eventColorId}` : null,
          eventLocation ? `Location: ${eventLocation}` : null,
          eventDescription ? `Description: ${eventDescription.slice(0, 1500)}` : null,
          attendeeEmails.length ? `Attendees: ${attendeeEmails.join(", ")}` : null,
          event.htmlLink ? `Google link: ${String(event.htmlLink)}` : null,
        ].filter(Boolean).join("\n");

        const { data: insAppt, error: apptErr } = await sb
          .from("appointments")
          .insert({
            staff_id: staffId,
            service_id: resolvedServiceId,
            client_name: summary,
            client_phone: null,
            start_time: startIso,
            end_time: endIso,
            status: googleStatus === "cancelled" ? "cancelled" : "confirmed",
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
          service_id: resolvedServiceId,
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
              google_calendar_id: eventCalendarId,
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
