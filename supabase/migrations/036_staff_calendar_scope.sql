-- 036_staff_calendar_scope.sql
-- Расширяем Google Calendar инфраструктуру:
--   * каждый сотрудник может подключить СВОЙ Google Calendar
--     (а не только общий салонный);
--   * outbox-задачи теперь умеют адресоваться двум целям:
--     'salon' (общий календарь салона) и 'staff:<uuid>' (личный
--     календарь мастера, на которого назначена запись);
--   * трюк с E-mail-уведомлениями НЕ используем — сами события
--     создаются в Google Calendar и Google уже умеет уведомлять
--     владельца календаря (push, web, mobile) без спама на ящик.
--
-- Скрипт идемпотентен: повторное применение ничего не ломает.

-- ------------------------------------------------------------------
-- 1. Колонки на staff под состояние личного календаря.
--    Сами refresh/access токены лежат в google_oauth_tokens с
--    scope_key='staff:<uuid>' (закрыто RLS от anon).
-- ------------------------------------------------------------------
alter table public.staff
  add column if not exists google_calendar_status        text not null default 'disconnected'
    check (google_calendar_status in ('disconnected','connecting','connected','error')),
  add column if not exists google_calendar_account_email text,
  add column if not exists google_calendar_id            text,
  add column if not exists google_calendar_last_sync_at  timestamptz,
  add column if not exists google_calendar_last_error    text;

comment on column public.staff.google_calendar_status is
  'Состояние подключения личного Google Calendar мастера. disconnected/connecting/connected/error.';
comment on column public.staff.google_calendar_account_email is
  'E-mail Google-аккаунта, к которому привязан личный календарь мастера.';
comment on column public.staff.google_calendar_id is
  'ID целевого календаря в Google (обычно primary либо отдельный календарь "AlesSanna — мои записи").';

-- ------------------------------------------------------------------
-- 2. Расширяем google_oauth_tokens опциональным staff_id.
--    Уже существует scope_key text unique — для салона держим
--    'salon', для мастера — 'staff:<uuid>'. staff_id хранится
--    отдельно, чтобы on delete cascade убирал токены при удалении
--    сотрудника.
-- ------------------------------------------------------------------
alter table public.google_oauth_tokens
  add column if not exists staff_id uuid references public.staff (id) on delete cascade;

create index if not exists idx_google_oauth_tokens_staff
  on public.google_oauth_tokens (staff_id)
  where staff_id is not null;

-- ------------------------------------------------------------------
-- 3. notifications_outbox: добавляем target_scope.
--    'salon'             → событие пишется в общий календарь салона;
--    'staff:<uuid>'      → событие пишется в личный календарь мастера.
-- ------------------------------------------------------------------
alter table public.notifications_outbox
  add column if not exists target_scope text not null default 'salon';

create index if not exists idx_notifications_outbox_scope
  on public.notifications_outbox (target_scope, status);

comment on column public.notifications_outbox.target_scope is
  'Адресат события: salon (общий календарь) или staff:<uuid> (личный календарь мастера).';

-- ------------------------------------------------------------------
-- 4. Перепишем триггер enqueue_appointment_outbox: создаёт ДО ДВУХ
--    задач — для салона и для мастера. Если ни один из них не
--    подключён к Google Calendar — задачи копятся как 'skipped',
--    их можно прогнать через outbox_resume_skipped() позже.
--    Никаких email-уведомлений салону/клиенту НЕ создаётся —
--    Google Calendar сам уведомляет владельца.
-- ------------------------------------------------------------------
create or replace function public.enqueue_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon_status text;
  v_staff_status text;
  v_payload      jsonb;
begin
  -- Базовый payload (один и тот же для обоих адресатов; Edge Function
  -- использует target_scope, чтобы выбрать в какой календарь писать).
  v_payload := jsonb_build_object(
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
  );

  -- ---- салон ---------------------------------------------------
  select coalesce(value, 'disconnected')
    into v_salon_status
    from public.salon_settings
    where key = 'google_calendar_status'
    limit 1;

  insert into public.notifications_outbox (
    appointment_id, kind, target_scope, payload, status
  )
  values (
    new.id,
    'google_calendar_event',
    'salon',
    v_payload,
    case when v_salon_status = 'connected' then 'pending' else 'skipped' end
  );

  -- ---- личный календарь мастера --------------------------------
  if new.staff_id is not null then
    select coalesce(google_calendar_status, 'disconnected')
      into v_staff_status
      from public.staff
      where id = new.staff_id;

    insert into public.notifications_outbox (
      appointment_id, kind, target_scope, payload, status
    )
    values (
      new.id,
      'google_calendar_event',
      'staff:' || new.staff_id::text,
      v_payload,
      case when v_staff_status = 'connected' then 'pending' else 'skipped' end
    );
  end if;

  return new;
exception when others then
  raise warning 'enqueue_appointment_outbox failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_appointment_outbox() from public;

-- Триггер уже создан в 035; пересоздавать не нужно.

-- ------------------------------------------------------------------
-- 5. RPC для CRM: обновить статус подключения календаря сотрудника.
--    Edge Function нужна для реального OAuth-обмена; CRM использует
--    эту функцию только для ручного «отключить» (set disconnected,
--    стираем account_email/calendar_id и удаляем токены).
-- ------------------------------------------------------------------
create or replace function public.staff_google_calendar_disconnect(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff
     set google_calendar_status = 'disconnected',
         google_calendar_account_email = null,
         google_calendar_id = null,
         google_calendar_last_error = null
   where id = p_staff_id;

  delete from public.google_oauth_tokens
   where scope_key = 'staff:' || p_staff_id::text;
end;
$$;

revoke all on function public.staff_google_calendar_disconnect(uuid) from public;
grant execute on function public.staff_google_calendar_disconnect(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 6. Хелпер: «прогнать skipped» с фильтром по scope, чтобы CRM
--    могла отдельно реактивировать задачи салона и задачи
--    конкретного мастера. Без аргумента — прогоняет все.
-- ------------------------------------------------------------------
create or replace function public.outbox_resume_skipped(p_scope text default null)
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
   where status = 'skipped'
     and (p_scope is null or target_scope = p_scope);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.outbox_resume_skipped(text) from public;
grant execute on function public.outbox_resume_skipped(text) to anon, authenticated, service_role;

-- Старая 0-аргументная версия из 035 остаётся ради обратной
-- совместимости (CRM ещё может её вызывать). Postgres различает
-- их по сигнатуре.
