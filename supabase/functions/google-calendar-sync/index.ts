import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-goog-channel-id, x-goog-resource-id, x-goog-resource-state",
};

type OutboxRow = {
  id: string;
  appointment_id: string | null;
  target_scope: string;
  payload: Record<string, unknown>;
  attempts: number;
  status: string;
  last_attempt_at: string | null;
};

type AppointmentSnapshot = Record<string, unknown> & {
  id: string;
  staff_id: string;
  service_id: string | number;
  client_name: string;
  client_phone: string | null;
  start_time: string;
  end_time: string;
  status: string;
  note: string | null;
  source: string | null;
  google_event_id: string | null;
  staff_name?: string | null;
  staff_calendar_email?: string | null;
  staff_google_account_email?: string | null;
  service_name?: string | null;
  service_duration_min?: number | null;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function parsePhone(input: string): string | null {
  const m = input.match(/\+?[0-9][0-9\s\-()]{5,}/);
  return m ? m[0].trim() : null;
}

function parseClient(summary: string, description: string): { name: string; phone: string | null } {
  const name = summary.trim() || "Клиент (Google)";
  const phone = parsePhone(`${summary}\n${description}`);
  return { name, phone };
}

function detectScopeCalendarId(scope: string, staffCalendarId: string | null, salonCalendarId: string | null): string {
  if (scope.startsWith("staff:") && staffCalendarId) return staffCalendarId;
  return salonCalendarId || "primary";
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAtIso: string | null }> {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(`Google token refresh failed (${res.status})`);
  }
  const expiresIn = Number(data.expires_in ?? 0);
  const expiresAtIso =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
  return { accessToken: String(data.access_token), expiresAtIso };
}

async function getScopeTokens(sb: ReturnType<typeof createClient>, scope: string) {
  const { data: tokenRow, error: tokenErr } = await sb
    .from("google_oauth_tokens")
    .select("scope_key, access_token, refresh_token, expires_at")
    .eq("scope_key", scope)
    .maybeSingle();
  if (tokenErr) throw new Error(tokenErr.message);
  if (!tokenRow?.refresh_token) throw new Error(`Missing refresh token for scope ${scope}`);
  const refreshed = await refreshAccessToken(String(tokenRow.refresh_token));
  await sb
    .from("google_oauth_tokens")
    .update({
      access_token: refreshed.accessToken,
      expires_at: refreshed.expiresAtIso,
    })
    .eq("scope_key", scope);
  return refreshed.accessToken;
}

async function loadAppointmentSnapshot(
  sb: ReturnType<typeof createClient>,
  appointmentId: string,
): Promise<AppointmentSnapshot | null> {
  const { data, error } = await sb
    .from("appointments")
    .select("id,staff_id,service_id,client_name,client_phone,start_time,end_time,status,note,source,google_event_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as AppointmentSnapshot;
  const [staffRes, serviceRes] = await Promise.all([
    sb
      .from("staff")
      .select("name,calendar_email,google_calendar_account_email")
      .eq("id", row.staff_id)
      .maybeSingle(),
    sb
      .from("service_listings")
      .select("name,duration")
      .eq("id", row.service_id)
      .maybeSingle(),
  ]);
  row.staff_name = (staffRes.data?.name as string | undefined) ?? null;
  row.staff_calendar_email = (staffRes.data?.calendar_email as string | undefined) ?? null;
  row.staff_google_account_email =
    (staffRes.data?.google_calendar_account_email as string | undefined) ?? null;
  row.service_name = (serviceRes.data?.name as string | undefined) ?? null;
  row.service_duration_min =
    serviceRes.data?.duration != null ? Number(serviceRes.data.duration) : null;
  return row;
}

async function upsertGoogleEvent(
  accessToken: string,
  calendarId: string,
  payload: Record<string, unknown>,
  existingEventId: string | null,
) {
  const start = String(payload.start_time ?? "");
  const end = String(payload.end_time ?? "");
  const name = String(payload.client_name ?? "Клиент");
  const serviceName = String(payload.service_name ?? "").trim();
  const staffName = String(payload.staff_name ?? "").trim();
  const durationMin = Number(payload.service_duration_min ?? 0);
  const phone = String(payload.client_phone ?? "");
  const note = String(payload.note ?? "");
  const source = String(payload.source ?? "");
  const targetScope = String(payload.target_scope ?? "");
  const staffEmail = String(
    payload.staff_calendar_email ?? payload.staff_google_account_email ?? "",
  ).trim();
  const operation = String(payload.operation ?? "upsert");

  if (operation === "delete" && existingEventId) {
    const delRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`Google delete failed (${delRes.status})`);
    }
    return { eventId: existingEventId, etag: null };
  }

  const baseTitle = serviceName ? `${name} — ${serviceName}` : name;
  const assignmentTag =
    targetScope === "salon" && staffName ? ` [${staffName}]` : "";
  const title = `${baseTitle}${assignmentTag}`;
  const bookingId = String(payload.appointment_id ?? "");
  const body: Record<string, unknown> = {
    summary: title,
    description: [
      bookingId ? `Booking ID: ${bookingId}` : null,
      serviceName ? `Service: ${serviceName}` : null,
      staffName ? `Master: ${staffName}` : null,
      targetScope === "salon" && staffName ? `Assigned via salon calendar: ${staffName}` : null,
      phone ? `Phone: ${phone}` : null,
      durationMin > 0 ? `Duration: ${durationMin} min` : null,
      source ? `Source: ${source}` : null,
      note ? `Note: ${note}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: start, timeZone: "Europe/Tallinn" },
    end: { dateTime: end, timeZone: "Europe/Tallinn" },
    extendedProperties: {
      private: {
        assigned_master_name: staffName || "",
        assigned_master_email: staffEmail || "",
        routing_scope: targetScope || "",
        sync_source: source || "",
      },
    },
  };
  if (staffEmail && !calendarId.includes(staffEmail)) {
    body.attendees = [{ email: staffEmail }];
  }
  const hasId = !!existingEventId;
  const url = hasId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existingEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const method = hasId ? "PATCH" : "POST";
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok || !jsonBody?.id) {
    throw new Error(`Google upsert failed (${res.status})`);
  }
  return {
    eventId: String(jsonBody.id),
    etag: jsonBody.etag ? String(jsonBody.etag) : null,
  };
}

async function hasGoogleConflict(
  accessToken: string,
  calendarId: string,
  startIso: string,
  endIso: string,
  ignoreEventId: string | null,
): Promise<boolean> {
  const qs = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "false",
    timeMin: startIso,
    timeMax: endIso,
    maxResults: "10",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google availability check failed (${res.status})`);
  const events = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
  return events.some((e) => {
    const eid = String(e.id ?? "");
    const status = String(e.status ?? "");
    if (!eid || status === "cancelled") return false;
    if (ignoreEventId && eid === ignoreEventId) return false;
    return true;
  });
}

async function processOutbox(
  sb: ReturnType<typeof createClient>,
  opts?: { appointmentId?: string | null },
) {
  const { data: settingsRows } = await sb
    .from("salon_settings")
    .select("key,value")
    .in("key", ["google_calendar_id"]);
  const salonCalendarId =
    settingsRows?.find((r: { key: string; value: string | null }) => r.key === "google_calendar_id")
      ?.value ?? "primary";

  const { data: rows, error } = await sb
    .from("notifications_outbox")
    .select("id,appointment_id,target_scope,payload,attempts,status,last_attempt_at")
    .eq("kind", "google_calendar_event")
    .in("status", ["pending", "error"])
    .order("created_at", { ascending: true })
    .limit(120);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const onlyAppointment = opts?.appointmentId ? String(opts.appointmentId) : "";
  const outboxRows = ((rows ?? []) as OutboxRow[]).filter((row) => {
    if (onlyAppointment && String(row.appointment_id ?? "") !== onlyAppointment) return false;
    if (row.status === "pending") return true;
    // automatic retry queue for failed deliveries (max 6 attempts, progressive backoff)
    if (row.attempts >= 6) return false;
    const delayMs = Math.min(15 * 60 * 1000, Math.max(15_000, row.attempts * 45_000));
    const lastTs = row.last_attempt_at ? Date.parse(row.last_attempt_at) : 0;
    if (!Number.isFinite(lastTs) || lastTs <= 0) return true;
    return now - lastTs >= delayMs;
  });
  let processed = 0;
  let failed = 0;
  console.log(
    JSON.stringify({
      msg: "sync_batch_started",
      eligible: outboxRows.length,
      fetched: (rows ?? []).length,
    }),
  );

  for (const row of outboxRows) {
    try {
      console.log(
        JSON.stringify({
          msg: "sync_row_received",
          outbox_id: row.id,
          appointment_id: row.appointment_id,
          target_scope: row.target_scope,
          attempts: row.attempts,
          previous_status: row.status,
        }),
      );
      const scope = row.target_scope || "salon";
      const scopeKey = scope === "salon" ? "salon" : scope;
      const staffId = scope.startsWith("staff:") ? scope.slice("staff:".length) : null;
      let staffCalendarId: string | null = null;
      if (staffId) {
        const { data: staffRow } = await sb
          .from("staff")
          .select("google_calendar_id")
          .eq("id", staffId)
          .maybeSingle();
        staffCalendarId = (staffRow?.google_calendar_id as string | null) ?? null;
      }
      const calendarId = detectScopeCalendarId(scope, staffCalendarId, salonCalendarId);
      console.log(
        JSON.stringify({
          msg: "sync_master_resolved",
          outbox_id: row.id,
          staff_id: staffId,
          staff_calendar_id: staffCalendarId,
        }),
      );
      if (!calendarId || calendarId === "primary") {
        throw new Error(`Missing calendarId for scope ${scope}`);
      }
      console.log(
        JSON.stringify({
          msg: "sync_calendar_selected",
          outbox_id: row.id,
          scope,
          scope_key: scopeKey,
          calendar_id: calendarId,
        }),
      );
      console.log(JSON.stringify({ msg: "sync_auth_check_started", outbox_id: row.id, scope_key: scopeKey }));
      const accessToken = await getScopeTokens(sb, scopeKey);
      console.log(JSON.stringify({ msg: "sync_auth_check_ok", outbox_id: row.id, scope_key: scopeKey }));

      const payload = { ...(row.payload ?? {}) };
      if (!payload.appointment_id && row.appointment_id) payload.appointment_id = row.appointment_id;
      const appointmentId = String(payload.appointment_id ?? "");
      const snapshot = appointmentId ? await loadAppointmentSnapshot(sb, appointmentId) : null;
      const sourcePayload = snapshot
        ? { ...payload, ...snapshot, target_scope: scope }
        : { ...payload, target_scope: scope };

      let existingEventId = (sourcePayload.google_event_id as string | undefined) ?? null;
      if (!existingEventId && appointmentId) {
        const { data: linkRow } = await sb
          .from("google_calendar_event_links")
          .select("google_event_id")
          .eq("provider", "google")
          .eq("calendar_scope", scope)
          .eq("appointment_id", appointmentId)
          .maybeSingle();
        existingEventId = (linkRow?.google_event_id as string | undefined) ?? null;
      }

      const op = String(sourcePayload.operation ?? "upsert");
      const startIso = String(sourcePayload.start_time ?? "");
      const endIso = String(sourcePayload.end_time ?? "");
      if (op !== "delete" && startIso && endIso) {
        const conflict = await hasGoogleConflict(
          accessToken,
          calendarId,
          startIso,
          endIso,
          existingEventId,
        );
        if (conflict) {
          throw new Error("Google calendar conflict: target slot is already occupied.");
        }
      }

      console.log(
        JSON.stringify({
          msg: "sync_google_upsert_start",
          outbox_id: row.id,
          appointment_id: appointmentId,
          operation: op,
          payload: {
            start_time: sourcePayload.start_time ?? null,
            end_time: sourcePayload.end_time ?? null,
            client_name: sourcePayload.client_name ?? null,
            staff_id: sourcePayload.staff_id ?? null,
            service_id: sourcePayload.service_id ?? null,
            calendar_id: calendarId,
          },
        }),
      );
      const up = await upsertGoogleEvent(accessToken, calendarId, sourcePayload, existingEventId);
      console.log(
        JSON.stringify({
          msg: "sync_google_upsert_done",
          outbox_id: row.id,
          appointment_id: appointmentId,
          event_id: up.eventId,
          etag: up.etag,
        }),
      );

      if (appointmentId && up.eventId) {
        await sb
          .from("appointments")
          .update({
            google_event_id: up.eventId,
            google_calendar_scope: scope,
            google_event_etag: up.etag,
            google_last_synced_at: new Date().toISOString(),
          })
          .eq("id", appointmentId);
      }

      await sb.from("google_calendar_event_links").upsert(
        {
          provider: "google",
          calendar_scope: scope,
          google_calendar_id: calendarId,
          google_event_id: up.eventId,
          google_event_etag: up.etag,
          appointment_id: appointmentId || null,
          google_event_status: String(sourcePayload.status ?? "confirmed"),
          google_event_updated_at: new Date().toISOString(),
          raw_event: sourcePayload,
        },
        { onConflict: "provider,calendar_scope,google_calendar_id,google_event_id" },
      );

      await sb
        .from("notifications_outbox")
        .update({
          status: "sent",
          attempts: row.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          last_error: null,
          external_ref: up.eventId,
        })
        .eq("id", row.id);
      console.log(
        JSON.stringify({
          msg: "sync_row_completed",
          outbox_id: row.id,
          appointment_id: appointmentId,
          status: "sent",
        }),
      );
      processed++;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await sb
        .from("notifications_outbox")
        .update({
          status: "error",
          attempts: row.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          last_error: errMsg,
        })
        .eq("id", row.id);
      console.log(
        JSON.stringify({
          msg: "sync_row_failed",
          outbox_id: row.id,
          appointment_id: row.appointment_id,
          reason: errMsg,
          next_retry_attempt: row.attempts + 1,
        }),
      );
      failed++;
    }
  }

  return { processed, failed, total: outboxRows.length };
}

async function incrementalPullScope(
  sb: ReturnType<typeof createClient>,
  scope: string,
  calendarId: string,
  accessToken: string,
) {
  const { data: stateRow } = await sb
    .from("google_calendar_sync_state")
    .select("sync_token")
    .eq("scope", scope)
    .maybeSingle();

  const qs = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "2500",
  });
  if (stateRow?.sync_token) qs.set("syncToken", String(stateRow.sync_token));
  else qs.set("timeMin", new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString());

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google incremental pull failed (${res.status})`);
  }

  const items = (body.items ?? []) as Array<Record<string, unknown>>;
  const nextSyncToken = typeof body.nextSyncToken === "string" ? body.nextSyncToken : null;

  const { data: staffRows } = await sb
    .from("staff")
    .select("id,name,calendar_email,google_calendar_account_email,google_calendar_id,is_active")
    .eq("is_active", true);
  const { data: serviceRows } = await sb
    .from("service_listings")
    .select("id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1);
  const fallbackServiceId = String(serviceRows?.[0]?.id ?? "");

  for (const event of items) {
    const eventId = String(event.id || "");
    if (!eventId) continue;
    const status = String(event.status || "");
    const summary = String(event.summary || "");
    const description = String(event.description || "");
    const startRaw = event.start as Record<string, unknown> | undefined;
    const endRaw = event.end as Record<string, unknown> | undefined;
    const startIso = typeof startRaw?.dateTime === "string" ? String(startRaw.dateTime) : null;
    const endIso = typeof endRaw?.dateTime === "string" ? String(endRaw.dateTime) : null;

    const { data: existingLink } = await sb
      .from("google_calendar_event_links")
      .select("appointment_id")
      .eq("provider", "google")
      .eq("calendar_scope", scope)
      .eq("google_calendar_id", calendarId)
      .eq("google_event_id", eventId)
      .maybeSingle();
    const linkedAppointmentId = (existingLink?.appointment_id as string | undefined) ?? null;

    if (status === "cancelled") {
      if (linkedAppointmentId) {
        await sb
          .from("appointments")
          .update({
            status: "cancelled",
            google_last_synced_at: new Date().toISOString(),
            google_sync_source: "google",
          })
          .eq("id", linkedAppointmentId);
      }
      continue;
    }

    if (!startIso || !endIso || !fallbackServiceId) continue;

    let staffId = scope.startsWith("staff:") ? scope.slice("staff:".length) : null;
    if (!staffId) {
      const attendees = Array.isArray(event.attendees)
        ? (event.attendees as Array<Record<string, unknown>>)
        : [];
      for (const a of attendees) {
        const email = String(a.email ?? "").toLowerCase();
        const matched = (staffRows ?? []).find(
          (s: Record<string, unknown>) =>
            String(s.calendar_email ?? s.google_calendar_account_email ?? "").toLowerCase() === email,
        );
        if (matched?.id) {
          staffId = String(matched.id);
          break;
        }
      }
      if (!staffId) {
        const first = (staffRows ?? [])[0] as Record<string, unknown> | undefined;
        staffId = first?.id ? String(first.id) : null;
      }
    }
    if (!staffId) continue;

    const parsed = parseClient(summary, description);

    let appointmentId = linkedAppointmentId;
    if (appointmentId) {
      await sb
        .from("appointments")
        .update({
          staff_id: staffId,
          service_id: fallbackServiceId,
          client_name: parsed.name,
          client_phone: parsed.phone,
          start_time: startIso,
          end_time: endIso,
          status: "confirmed",
          note: description || null,
          google_event_id: eventId,
          google_calendar_scope: scope,
          google_event_etag: event.etag ? String(event.etag) : null,
          google_last_synced_at: new Date().toISOString(),
          google_sync_source: "google",
        })
        .eq("id", appointmentId);
    } else {
      const { data: ins } = await sb
        .from("appointments")
        .insert({
          staff_id: staffId,
          service_id: fallbackServiceId,
          client_name: parsed.name,
          client_phone: parsed.phone,
          start_time: startIso,
          end_time: endIso,
          status: "confirmed",
          source: "crm",
          note: description || null,
          google_event_id: eventId,
          google_calendar_scope: scope,
          google_event_etag: event.etag ? String(event.etag) : null,
          google_last_synced_at: new Date().toISOString(),
          google_sync_source: "google",
        })
        .select("id")
        .limit(1);
      appointmentId = String(ins?.[0]?.id ?? "");
      if (appointmentId) {
        await sb.from("appointment_services").insert({
          appointment_id: appointmentId,
          service_id: fallbackServiceId,
          staff_id: staffId,
          start_time: startIso,
          end_time: endIso,
        });
      }
    }

    if (appointmentId) {
      await sb.from("google_calendar_event_links").upsert(
        {
          provider: "google",
          calendar_scope: scope,
          google_calendar_id: calendarId,
          google_event_id: eventId,
          google_event_status: status,
          google_event_updated_at: event.updated ? String(event.updated) : null,
          google_event_etag: event.etag ? String(event.etag) : null,
          appointment_id: appointmentId,
          raw_event: event,
        },
        { onConflict: "provider,calendar_scope,google_calendar_id,google_event_id" },
      );
    }
  }

  await sb.from("google_calendar_sync_state").upsert({
    scope,
    google_calendar_id: calendarId,
    sync_token: nextSyncToken ?? stateRow?.sync_token ?? null,
    last_pull_at: new Date().toISOString(),
    last_webhook_at: new Date().toISOString(),
    last_error: null,
  });

  return { scope, processed: items.length, nextSyncToken: !!nextSyncToken };
}

async function handleWebhook(sb: ReturnType<typeof createClient>, req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceState = req.headers.get("x-goog-resource-state");
  if (!channelId) return json(400, { error: "Missing x-goog-channel-id" });
  if (resourceState === "sync") return json(200, { ok: true, ignored: "sync_probe" });

  const { data: stateRow, error } = await sb
    .from("google_calendar_sync_state")
    .select("scope,google_calendar_id")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!stateRow?.scope) return json(404, { error: "Channel not found" });

  const scope = String(stateRow.scope);
  const scopeKey = scope === "salon" ? "salon" : scope;
  const accessToken = await getScopeTokens(sb, scopeKey);
  const result = await incrementalPullScope(
    sb,
    scope,
    String(stateRow.google_calendar_id),
    accessToken,
  );
  return json(200, { ok: true, scope, result });
}

async function startWatch(sb: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const scope = String(body.scope ?? "salon");
  const channelId = crypto.randomUUID();

  const { data: settingsRows } = await sb
    .from("salon_settings")
    .select("key,value")
    .in("key", ["google_calendar_id"]);
  const salonCalendarId =
    settingsRows?.find((r: { key: string; value: string | null }) => r.key === "google_calendar_id")
      ?.value ?? "primary";

  let calendarId = salonCalendarId;
  if (scope.startsWith("staff:")) {
    const sid = scope.slice("staff:".length);
    const { data: staffRow } = await sb
      .from("staff")
      .select("google_calendar_id")
      .eq("id", sid)
      .maybeSingle();
    if (staffRow?.google_calendar_id) calendarId = String(staffRow.google_calendar_id);
  }

  const scopeKey = scope === "salon" ? "salon" : scope;
  const accessToken = await getScopeTokens(sb, scopeKey);
  const webhookUrl =
    String(body.webhookUrl ?? "").trim() ||
    `${SUPABASE_URL.replace(".co", ".co/functions/v1")}/google-calendar-sync`;

  const watchRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
      }),
    },
  );
  const watchBody = await watchRes.json().catch(() => ({}));
  if (!watchRes.ok) throw new Error(`Google watch failed (${watchRes.status})`);

  await sb.from("google_calendar_sync_state").upsert({
    scope,
    google_calendar_id: calendarId,
    channel_id: channelId,
    channel_resource_id: watchBody.resourceId ? String(watchBody.resourceId) : null,
    channel_expires_at: watchBody.expiration
      ? new Date(Number(watchBody.expiration)).toISOString()
      : null,
    last_error: null,
  });

  return json(200, { ok: true, scope, calendarId, channelId });
}

async function testEvent(sb: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const scope = String(body.scope ?? "salon");
  const title = String(body.title ?? "CRM test event");
  const scopeKey = scope === "salon" ? "salon" : scope;
  const accessToken = await getScopeTokens(sb, scopeKey);
  const { data: settingsRows } = await sb
    .from("salon_settings")
    .select("key,value")
    .in("key", ["google_calendar_id"]);
  const salonCalendarId =
    settingsRows?.find((r: { key: string; value: string | null }) => r.key === "google_calendar_id")
      ?.value ?? "primary";
  let staffCalendarId: string | null = null;
  if (scope.startsWith("staff:")) {
    const sid = scope.slice("staff:".length);
    const { data: staffRow } = await sb.from("staff").select("google_calendar_id").eq("id", sid).maybeSingle();
    staffCalendarId = (staffRow?.google_calendar_id as string | null) ?? null;
  }
  const calendarId = detectScopeCalendarId(scope, staffCalendarId, salonCalendarId);
  if (!calendarId || calendarId === "primary") {
    throw new Error(`Missing calendarId for test_event scope ${scope}`);
  }
  const start = new Date(Date.now() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        description: "Created by google-calendar-sync test_event",
        start: { dateTime: start.toISOString(), timeZone: "Europe/Tallinn" },
        end: { dateTime: end.toISOString(), timeZone: "Europe/Tallinn" },
      }),
    },
  );
  const bodyJson = await res.json().catch(() => ({}));
  if (!res.ok || !bodyJson?.id) throw new Error(`Google test event failed (${res.status})`);
  return json(200, { ok: true, scope, calendarId, eventId: String(bodyJson.id) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "Missing Supabase env" });
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return json(500, { error: "Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET" });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (req.headers.get("x-goog-channel-id")) {
      return await handleWebhook(sb, req);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = String(body.mode ?? "drain");

    if (mode === "start_watch") {
      return await startWatch(sb, body);
    }
    if (mode === "webhook_pull") {
      const scope = String(body.scope ?? "salon");
      const calendarId = String(body.calendarId ?? "primary");
      const scopeKey = scope === "salon" ? "salon" : scope;
      const accessToken = await getScopeTokens(sb, scopeKey);
      const result = await incrementalPullScope(sb, scope, calendarId, accessToken);
      return json(200, { ok: true, mode, result });
    }
    if (mode === "test_event") {
      return await testEvent(sb, body);
    }
    const appointmentId = body.appointmentId ? String(body.appointmentId) : null;
    const result = await processOutbox(sb, { appointmentId });
    return json(200, { ok: true, mode: "drain", ...result });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

