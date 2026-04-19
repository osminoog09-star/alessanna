-- 043_email_followup_jobs.sql
-- ============================================================================
-- P1: Auto-followup email — очередь писем клиентам.
--
-- Сценарии:
--   1. confirmation       — сразу после создания записи: «Спасибо, ждём вас N»
--   2. reminder_24h       — за 24 часа до начала: «Напоминаем о визите»
--   3. thank_you_followup — через 24 часа после окончания: «Как всё прошло?»
--
-- Архитектура:
--   • При INSERT в appointments триггер `appointments_generate_email_jobs`
--     создаёт до 3 строк в email_jobs (только если у клиента есть email и
--     appointment не cancelled).
--   • При смене status='cancelled' ещё-не-отправленные jobs помечаются
--     'cancelled' (отдельный триггер).
--   • Отправщик (Edge function `send-followup-emails`) каждую минуту берёт
--     pending-jobs где scheduled_at <= now(), отсылает через Resend и
--     обновляет status -> 'sent' | 'failed' (с сохранением последней ошибки).
--   • pg_cron вызывает Edge function через pg_net.http_post (см. ниже).
--
-- ВАЖНО: Edge function НЕ создаётся MCP'ом — её нужно деплоить через
--   supabase functions deploy send-followup-emails
-- Файл функции лежит в supabase/functions/send-followup-emails/index.ts.
-- ============================================================================

-- 0. Колонки email на clients и appointments (раньше не было).
alter table public.clients
  add column if not exists email text;

alter table public.appointments
  add column if not exists client_email text;

create index if not exists clients_email_idx
  on public.clients (lower(email))
  where email is not null;

-- 1. Очередь
create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  job_type text not null check (job_type in (
    'confirmation', 'reminder_24h', 'thank_you_followup', 'manual'
  )),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in (
    'pending', 'sent', 'failed', 'cancelled', 'skipped'
  )),
  attempts int not null default 0,
  last_error text,
  payload jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_jobs_due_idx
  on public.email_jobs (scheduled_at)
  where status = 'pending';

create index if not exists email_jobs_appointment_idx
  on public.email_jobs (appointment_id)
  where appointment_id is not null;

create index if not exists email_jobs_status_idx
  on public.email_jobs (status, scheduled_at desc);

create or replace function public.email_jobs_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_email_jobs_touch on public.email_jobs;
create trigger trg_email_jobs_touch
  before update on public.email_jobs
  for each row execute function public.email_jobs_touch_updated_at();

-- 2. Триггер генерации jobs
create or replace function public.appointments_generate_email_jobs()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  resolved_email text;
  resolved_name text;
  appointment_end timestamptz;
begin
  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;

  -- Email берём в порядке приоритета: appointment.client_email,
  -- затем clients.email (если есть client_id).
  resolved_email := nullif(trim(new.client_email), '');
  resolved_name := nullif(trim(new.client_name), '');

  if resolved_email is null and new.client_id is not null then
    select c.email, coalesce(resolved_name, c.name)
      into resolved_email, resolved_name
    from public.clients c where c.id = new.client_id;
  end if;

  if resolved_email is null then
    return new;
  end if;

  -- 1. confirmation — сразу
  insert into public.email_jobs (
    appointment_id, client_id, recipient_email, recipient_name,
    job_type, scheduled_at
  ) values (
    new.id, new.client_id, resolved_email, resolved_name,
    'confirmation', now()
  );

  -- 2. reminder_24h
  if new.start_time is not null and new.start_time > now() + interval '24 hours' then
    insert into public.email_jobs (
      appointment_id, client_id, recipient_email, recipient_name,
      job_type, scheduled_at
    ) values (
      new.id, new.client_id, resolved_email, resolved_name,
      'reminder_24h', new.start_time - interval '24 hours'
    );
  end if;

  -- 3. thank_you_followup — через 24 часа после end_time
  appointment_end := coalesce(new.end_time, new.start_time + interval '1 hour');
  if appointment_end is not null then
    insert into public.email_jobs (
      appointment_id, client_id, recipient_email, recipient_name,
      job_type, scheduled_at
    ) values (
      new.id, new.client_id, resolved_email, resolved_name,
      'thank_you_followup', appointment_end + interval '24 hours'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_generate_email_jobs on public.appointments;
create trigger trg_appointments_generate_email_jobs
  after insert on public.appointments
  for each row execute function public.appointments_generate_email_jobs();

-- 3. Триггер cancel
create or replace function public.appointments_cancel_email_jobs()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
    update public.email_jobs
    set status = 'cancelled'
    where appointment_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_cancel_email_jobs on public.appointments;
create trigger trg_appointments_cancel_email_jobs
  after update on public.appointments
  for each row execute function public.appointments_cancel_email_jobs();

-- 4. Retry RPC
create or replace function public.email_jobs_retry(job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.email_jobs
  set status = 'pending',
      attempts = 0,
      last_error = null,
      scheduled_at = now()
  where id = job_id
    and status in ('failed', 'cancelled', 'skipped');
  if not found then
    return jsonb_build_object('status', 'not_retriable');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.email_jobs_retry(uuid) from public;
grant execute on function public.email_jobs_retry(uuid) to anon, authenticated;

-- 5. RLS
alter table public.email_jobs enable row level security;

drop policy if exists email_jobs_admin_all on public.email_jobs;
create policy email_jobs_admin_all
  on public.email_jobs
  for all to anon, authenticated
  using (true) with check (true);

comment on table public.email_jobs is
  'Очередь автоматических писем клиентам (confirmation, reminder_24h, thank_you_followup). Отправщик — Edge function send-followup-emails.';

-- ============================================================================
-- pg_cron: см. README в supabase/functions/send-followup-emails/README.md
-- ============================================================================
