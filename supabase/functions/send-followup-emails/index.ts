// supabase/functions/send-followup-emails/index.ts
// ----------------------------------------------------------------------------
// Edge function отправки email-followup.
//
// Каждый вызов:
//   1. Берёт до BATCH_SIZE pending-jobs где scheduled_at <= now().
//   2. Для каждого: рендерит шаблон, отправляет через Resend API.
//   3. Помечает sent / failed (с last_error и attempts++).
//   4. После 5 неудач job уходит в failed навсегда.
//
// Деплой:
//   supabase functions deploy send-followup-emails --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_xxx
//   supabase secrets set EMAIL_FROM='Alessanna <hello@alessannailu.com>'
//   supabase secrets set EMAIL_BCC=''         # опц., копия себе
//   supabase secrets set PUBLIC_SITE_URL='https://alessannailu.com'
//
// Если RESEND_API_KEY заменить на любой провайдер с REST API (SendGrid,
// Postmark, Mailgun) — поправьте sendOne() ниже.
// ----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type EmailJob = {
  id: string;
  appointment_id: string | null;
  client_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  job_type: "confirmation" | "reminder_24h" | "thank_you_followup" | "manual";
  scheduled_at: string;
  attempts: number;
  payload: Record<string, unknown> | null;
};

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "noreply@example.com";
const EMAIL_BCC = Deno.env.get("EMAIL_BCC") ?? "";
const PUBLIC_SITE_URL = Deno.env.get("PUBLIC_SITE_URL") ?? "https://alessannailu.com";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
  } catch {
    return iso;
  }
}

async function loadAppointment(id: string | null): Promise<{
  start_time: string | null;
  end_time: string | null;
  service_name: string | null;
  staff_name: string | null;
} | null> {
  if (!id) return null;
  const { data } = await sb
    .from("appointments")
    .select("start_time, end_time, service_id, staff_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  let serviceName: string | null = null;
  if (data.service_id) {
    const { data: svc } = await sb
      .from("service_listings")
      .select("name")
      .eq("id", data.service_id)
      .maybeSingle();
    serviceName = svc?.name ?? null;
  }
  let staffName: string | null = null;
  if (data.staff_id) {
    const { data: st } = await sb
      .from("staff")
      .select("name")
      .eq("id", data.staff_id)
      .maybeSingle();
    staffName = st?.name ?? null;
  }
  return {
    start_time: data.start_time,
    end_time: data.end_time,
    service_name: serviceName,
    staff_name: staffName,
  };
}

function renderTemplate(
  job: EmailJob,
  apt: Awaited<ReturnType<typeof loadAppointment>>
): { subject: string; html: string; text: string } {
  const name = escapeHtml(job.recipient_name || "Клиент");
  const when = apt?.start_time ? fmtDateTime(apt.start_time) : "";
  const what = apt?.service_name ? escapeHtml(apt.service_name) : "услуга";
  const who = apt?.staff_name ? escapeHtml(apt.staff_name) : "ваш мастер";

  switch (job.job_type) {
    case "confirmation":
      return {
        subject: `Запись подтверждена: ${what} — ${when || "скоро"}`,
        html: `
          <p>Здравствуйте, ${name}!</p>
          <p>Спасибо, что выбрали нас. Ваша запись подтверждена:</p>
          <ul>
            <li><strong>${what}</strong></li>
            <li>Когда: <strong>${escapeHtml(when)}</strong></li>
            <li>Мастер: ${who}</li>
          </ul>
          <p>Ждём вас!<br/>Alessanna</p>
          <p style="font-size:12px;color:#888"><a href="${PUBLIC_SITE_URL}">${PUBLIC_SITE_URL}</a></p>`,
        text: `Здравствуйте, ${name}!\nВаша запись подтверждена: ${what} — ${when}\nМастер: ${apt?.staff_name ?? ""}\nAlessanna · ${PUBLIC_SITE_URL}`,
      };
    case "reminder_24h":
      return {
        subject: `Напоминание: завтра в ${when}`,
        html: `
          <p>Здравствуйте, ${name}!</p>
          <p>Напоминаем о визите:</p>
          <ul>
            <li><strong>${what}</strong></li>
            <li>Когда: <strong>${escapeHtml(when)}</strong></li>
            <li>Мастер: ${who}</li>
          </ul>
          <p>Если планы изменились — пожалуйста, свяжитесь с нами заранее.</p>
          <p>До встречи!<br/>Alessanna</p>`,
        text: `Здравствуйте, ${name}!\nНапоминаем о визите завтра: ${what} — ${when}.\nЕсли планы изменились, дайте знать заранее.\nAlessanna`,
      };
    case "thank_you_followup":
      return {
        subject: "Спасибо, что были у нас",
        html: `
          <p>Здравствуйте, ${name}!</p>
          <p>Спасибо, что доверили нам ${what}. Если что-то понравилось особенно
          или, наоборот, можно улучшить — поделитесь, пожалуйста.</p>
          <p>Будем рады видеть снова!<br/>Alessanna</p>
          <p><a href="${PUBLIC_SITE_URL}/?book=1">Записаться ещё раз</a></p>`,
        text: `Здравствуйте, ${name}!\nСпасибо, что были у нас. Будем рады обратной связи и видеть снова.\nAlessanna · ${PUBLIC_SITE_URL}`,
      };
    default:
      return {
        subject: "Сообщение от Alessanna",
        html: `<p>${name}, у нас есть для вас сообщение.</p>`,
        text: `${name}, у нас есть для вас сообщение.`,
      };
  }
}

async function sendOne(job: EmailJob, message: { subject: string; html: string; text: string }) {
  if (!RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }
  const body: Record<string, unknown> = {
    from: EMAIL_FROM,
    to: [job.recipient_email],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (EMAIL_BCC) body.bcc = [EMAIL_BCC];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${err.slice(0, 500)}` };
  }
  return { ok: true, error: null };
}

async function processOnce(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data: jobs, error } = await sb
    .from("email_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("[send-followup-emails] load jobs failed", error);
    return { processed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const job of (jobs ?? []) as EmailJob[]) {
    const apt = await loadAppointment(job.appointment_id);
    const message = renderTemplate(job, apt);
    const r = await sendOne(job, message);
    if (r.ok) {
      await sb
        .from("email_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: job.attempts + 1 })
        .eq("id", job.id);
      sent++;
    } else {
      const nextAttempts = job.attempts + 1;
      const finalStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
      const nextScheduled =
        finalStatus === "pending"
          ? new Date(Date.now() + nextAttempts * 5 * 60 * 1000).toISOString() // exp backoff: 5,10,15,20 min
          : job.scheduled_at;
      await sb
        .from("email_jobs")
        .update({
          status: finalStatus,
          attempts: nextAttempts,
          last_error: r.error ?? "",
          scheduled_at: nextScheduled,
        })
        .eq("id", job.id);
      failed++;
    }
  }
  return { processed: (jobs ?? []).length, sent, failed };
}

Deno.serve(async (_req: Request) => {
  try {
    const result = await processOnce();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[send-followup-emails] fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
