-- 035_notifications_outbox_google_calendar.sql
-- Готовим инфраструктуру для будущей Google Calendar OAuth-интеграции:
-- сами события календаря будет создавать отдельный Edge Function (этап 2,
-- будет деплоен после регистрации Google OAuth client). Сейчас в БД мы:
--
--   1. Расширяем salon_settings ключами под статус подключения и
--      идентификатор внешнего календаря салона.
--   2. Создаём отдельную таблицу `google_oauth_tokens` для хранения
--      refresh_token / access_token. Доступ — ТОЛЬКО `service_role`,
--      потому что refresh_token = секрет на годы; никакая публичная
--      ссылка/CRM под anon-key не должна его прочитать.
--   3. Создаём очередь `notifications_outbox` — все доставки наружу
--      (Google Calendar event, e-mail, SMS) идут через неё.
--      Очередь читается CRM-ом (статус доставок), а Edge Function её
--      обрабатывает service_role-ключом и помечает строки sent/error.
--   4. Триггер `after insert on appointments` автоматически кладёт в
--      outbox задачу `google_calendar_event` со снимком данных записи.
--      Триггер SECURITY DEFINER — иначе anon-клиент, создавший запись
--      через `public_book_chain`, не смог бы записать в outbox.
--   5. RPC `outbox_retry(p_id uuid)` для CRM («Попробовать снова»).
--
-- Скрипт идемпотентен: безопасно прокатать несколько раз.

-- ------------------------------------------------------------------
-- 1. Дополнительные ключи в salon_settings (создана в 025).
-- ------------------------------------------------------------------
insert into public.salon_settings (key, value) values
  ('google_calendar_status',         'disconnected'),
  ('google_calendar_account_email',  null),
  ('google_calendar_id',             null),
  ('google_calendar_last_sync_at',   null),
  ('google_calendar_last_error',     null)
on conflict (key) do nothing;

comment on column public.salon_settings.value is
  'Free-form value. Особые ключи: salon_calendar_email (рабочий e-mail салона),
  google_calendar_status (disconnected|connecting|connected|error),
  google_calendar_account_email (e-mail подключённого Google-аккаунта),
  google_calendar_id (id целевого календаря, например ALES… или primary),
  google_calendar_last_sync_at, google_calendar_last_error.';

-- ------------------------------------------------------------------
-- 2. Защищённое хранилище OAuth-токенов.
--    Refresh token = долгоживущий секрет, поэтому RLS закрывает его
--    от anon полностью. Запись/чтение — service_role (Edge Function).
-- ------------------------------------------------------------------
create table if not exists public.google_oauth_tokens (
  id            uuid primary key default gen_random_uuid(),
  -- В будущем, когда появятся независимые мастера со своими аккаунтами,
  -- сюда ляжет staff_id или 'salon'. Пока поддерживаем одну строку 'salon'.
  scope_key     text not null unique default 'salon',
  account_email text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  granted_scope text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.google_oauth_tokens is
  'Зашифровывайте refresh_token на уровне приложения, если требуется compliance.
  RLS закрывает таблицу от anon — её читает и пишет ТОЛЬКО service_role
  (Edge Function), CRM работает с метаданными в salon_settings.';

alter table public.google_oauth_tokens enable row level security;

drop policy if exists google_oauth_tokens_no_anon_read   on public.google_oauth_tokens;
drop policy if exists google_oauth_tokens_no_anon_write  on public.google_oauth_tokens;

-- В RLS-режиме без матчей == deny. Намеренно НЕ создаём ни одной policy
-- для anon/authenticated. service_role bypass-ит RLS автоматически.

-- Триггер обновления updated_at.
create or replace function public.google_oauth_tokens_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_google_oauth_tokens_updated on public.google_oauth_tokens;
create trigger trg_google_oauth_tokens_updated
before update on public.google_oauth_tokens
for each row execute function public.google_oauth_tokens_touch_updated_at();

-- ------------------------------------------------------------------
-- 3. Очередь исходящих уведомлений.
-- ------------------------------------------------------------------
create table if not exists public.notifications_outbox (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id) on delete cascade,
  -- 'google_calendar_event' — основной канал; задел под 'email', 'sms', 'telegram'.
  kind            text not null default 'google_calendar_event'
                       check (kind in ('google_calendar_event', 'email', 'sms', 'telegram')),
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                       check (status in ('pending', 'sent', 'error', 'skipped')),
  attempts        int  not null default 0,
  last_error      text,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  external_ref    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_notifications_outbox_status_created
  on public.notifications_outbox (status, created_at desc);
create index if not exists idx_notifications_outbox_appt
  on public.notifications_outbox (appointment_id);
create index if not exists idx_notifications_outbox_kind
  on public.notifications_outbox (kind);

comment on table public.notifications_outbox is
  'Очередь внешних уведомлений (Google Calendar event, e-mail, SMS).
  Триггер `enqueue_appointment_outbox` создаёт строку при insert в appointments.
  Edge Function под service_role-ключом обрабатывает status=pending и
  помечает sent/error. CRM показывает очередь в /admin/integrations.';

alter table public.notifications_outbox enable row level security;

-- Чтение — для CRM (anon-key), запись/обновление/удаление — service_role.
drop policy if exists notifications_outbox_anon_read on public.notifications_outbox;
create policy notifications_outbox_anon_read on public.notifications_outbox
  for select using (true);

-- service_role bypass-ит RLS автоматически, но клиент CRM иногда
-- хочет нажать «Сбросить». Это идёт через RPC `outbox_retry`
-- ниже (SECURITY DEFINER) — поэтому отдельной anon-write policy не
-- открываем, чтобы не дать произвольные UPDATE с лендинга.

create or replace function public.notifications_outbox_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notifications_outbox_updated on public.notifications_outbox;
create trigger trg_notifications_outbox_updated
before update on public.notifications_outbox
for each row execute function public.notifications_outbox_touch_updated_at();

-- ------------------------------------------------------------------
-- 4. Триггер на appointments — кладёт задачу в outbox.
--    payload содержит достаточно полей, чтобы Edge Function мог
--    собрать summary и время события без второго round-trip; сами
--    appointment_services (chain-bookings) Edge Function подгрузит
--    отдельно по appointment_id.
-- ------------------------------------------------------------------
create or replace function public.enqueue_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  -- Статус Google-интеграции в момент создания записи. Если салон ещё
  -- не подключён — НЕ дёргаем Edge Function зря (status='skipped').
  -- Edge Function позже сможет «реанимировать» skipped-задачи, когда
  -- салон подключится: достаточно вызвать outbox_retry().
  select coalesce(value, 'disconnected')
    into v_status
    from public.salon_settings
    where key = 'google_calendar_status'
    limit 1;

  insert into public.notifications_outbox (
    appointment_id,
    kind,
    payload,
    status
  )
  values (
    new.id,
    'google_calendar_event',
    jsonb_build_object(
      'appointment_id',  new.id,
      'staff_id',        new.staff_id,
      'service_id',      new.service_id,
      'client_name',     new.client_name,
      'client_phone',    new.client_phone,
      'start_time',      new.start_time,
      'end_time',        new.end_time,
      'status',          new.status,
      'source',          new.source,
      'notes',           coalesce(new.notes, '')
    ),
    case when v_status = 'connected' then 'pending' else 'skipped' end
  );

  return new;
exception when others then
  -- Никогда не валим транзакцию создания записи из-за outbox.
  -- Сообщение уйдёт в Postgres logs и будет видно в Supabase dashboard.
  raise warning 'enqueue_appointment_outbox failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_appointment_outbox() from public;

drop trigger if exists trg_appointments_enqueue_outbox on public.appointments;
create trigger trg_appointments_enqueue_outbox
after insert on public.appointments
for each row execute function public.enqueue_appointment_outbox();

-- ------------------------------------------------------------------
-- 5. RPC: «Попробовать снова» — для кнопки в CRM.
--    SECURITY DEFINER, чтобы CRM под anon-key мог сбросить статус.
--    Сохраняет attempts=0 и last_error=null, чтобы Edge Function
--    взял задачу как новую.
-- ------------------------------------------------------------------
create or replace function public.outbox_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications_outbox
     set status = 'pending',
         attempts = 0,
         last_error = null,
         last_attempt_at = null
   where id = p_id
     and status in ('error', 'skipped');
end;
$$;

revoke all on function public.outbox_retry(uuid) from public;
grant execute on function public.outbox_retry(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 6. RPC: переактивация всех skipped-задач — когда салон подключил
--    Google Calendar постфактум, и хочется «прогнать» накопившиеся
--    записи через Edge Function.
-- ------------------------------------------------------------------
create or replace function public.outbox_resume_skipped()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.notifications_outbox
     set status = 'pending', attempts = 0, last_error = null, last_attempt_at = null
   where status = 'skipped';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.outbox_resume_skipped() from public;
grant execute on function public.outbox_resume_skipped() to anon, authenticated, service_role;
