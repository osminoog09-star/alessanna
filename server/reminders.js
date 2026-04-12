"use strict";

/**
 * Poll Supabase for upcoming bookings; log (or email) 24h and 2h reminders.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Set REMINDER_EMAIL_FROM + REMINDER_SMTP_URL (e.g. smtps://user:pass@smtp:465)
 * and optionally Nodemailer — otherwise reminders are console-only.
 */
const { getSupabaseAdmin } = require("./supabaseClient");

function hoursFromNow(h) {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function inWindow(target, lo, hi) {
  return target >= lo && target <= hi;
}

async function sendReminder({ toPhone, clientName, when }) {
  const msg = `Reminder: you have appointment at Alessanna at ${when} (${clientName}).`;
  const smtp = process.env.REMINDER_SMTP_URL;
  if (!smtp) {
    console.log("[reminder]", msg, toPhone ? `phone:${toPhone}` : "");
    return;
  }
  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport(smtp);
    const to = process.env.REMINDER_EMAIL_TO || process.env.REMINDER_FALLBACK_EMAIL;
    if (!to) {
      console.log("[reminder] no REMINDER_EMAIL_TO —", msg);
      return;
    }
    await transporter.sendMail({
      from: process.env.REMINDER_EMAIL_FROM || "noreply@localhost",
      to,
      subject: "Alessanna appointment reminder",
      text: msg,
    });
  } catch (err) {
    console.error("[reminder] email failed", err.message);
  }
}

async function runReminderCycle() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const now = new Date();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, client_name, client_phone, appointment_at, start_at, status")
    .in("status", ["pending", "confirmed"]);

  if (error || !bookings?.length) return;

  const { data: sent } = await supabase.from("booking_reminders").select("booking_id, kind");
  const sentSet = new Set((sent || []).map((r) => `${r.booking_id}:${r.kind}`));

  for (const b of bookings) {
    const iso = b.appointment_at || b.start_at;
    if (!iso) continue;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;
    if (at < now) continue;

    const t24lo = hoursFromNow(23);
    const t24hi = hoursFromNow(25);
    const t2lo = hoursFromNow(1.5);
    const t2hi = hoursFromNow(2.5);

    const whenStr = at.toISOString().slice(11, 16);

    if (inWindow(at, t24lo, t24hi) && !sentSet.has(`${b.id}:24h`)) {
      await sendReminder({
        toPhone: b.client_phone,
        clientName: b.client_name,
        when: whenStr,
      });
      await supabase.from("booking_reminders").insert({ booking_id: b.id, kind: "24h" });
      sentSet.add(`${b.id}:24h`);
    }

    if (inWindow(at, t2lo, t2hi) && !sentSet.has(`${b.id}:2h`)) {
      await sendReminder({
        toPhone: b.client_phone,
        clientName: b.client_name,
        when: whenStr,
      });
      await supabase.from("booking_reminders").insert({ booking_id: b.id, kind: "2h" });
      sentSet.add(`${b.id}:2h`);
    }
  }
}

function startReminderLoop(intervalMs = 5 * 60 * 1000) {
  const tick = () => {
    runReminderCycle().catch((e) => console.error("[reminders]", e));
  };
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { runReminderCycle, startReminderLoop };
