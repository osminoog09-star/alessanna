-- 025_staff_calendar_email.sql
-- Готовим сайт к двусторонней интеграции с Google Calendar:
--   * у сотрудника появляется персональный e-mail для Google/Apple/Outlook календаря
--     (на него будут лететь приглашения/ICS из будущего sync-модуля);
--   * в салоне появляется одна «главная» почта — рабочий Google-аккаунт, на
--     котором живёт общий календарь салона. Пока просто храним её в salon_settings
--     (настоящий OAuth-sync прикрутим отдельным шагом).
--
-- Этот проект НЕ использует supabase auth для CRM (вход через verify_staff_phone
-- RPC + localStorage), поэтому RLS для salon_settings ставим permissive — запись
-- идёт под anon-ключом с фронта, как и для остальных CRM-таблиц в этом проекте.
--
-- Скрипт идемпотентен: повторное применение ничего не ломает.

-- ------------------------------------------------------------------
-- 1. Колонка staff.calendar_email.
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'calendar_email'
  ) then
    alter table public.staff add column calendar_email text null;
  end if;
end $$;

comment on column public.staff.calendar_email is
  'Optional personal calendar e-mail (Google/Apple/Outlook) for the employee. When set, booking invites/ICS can be delivered to this address by a future Google Calendar sync job.';

-- Базовый sanity-check: либо null/пусто, либо похоже на e-mail.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff'::regclass
      and conname = 'staff_calendar_email_format'
  ) then
    alter table public.staff
      add constraint staff_calendar_email_format
      check (
        calendar_email is null
        or calendar_email = ''
        or calendar_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      );
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2. Таблица salon_settings (key/value для разовых настроек салона).
--    Храним сюда salon_calendar_email = рабочий Google-аккаунт салона.
-- ------------------------------------------------------------------
create table if not exists public.salon_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

comment on table public.salon_settings is
  'Simple key-value bag for singleton salon-wide settings (calendar e-mail, branding, etc.).';

insert into public.salon_settings (key, value)
values ('salon_calendar_email', null)
on conflict (key) do nothing;

alter table public.salon_settings enable row level security;

-- Чтение — всем (нужно CRM, который ходит под anon key).
drop policy if exists salon_settings_read on public.salon_settings;
create policy salon_settings_read on public.salon_settings
  for select using (true);

-- Запись — тоже под anon-ключом, как в остальных CRM-таблицах этого проекта.
-- Когда проект перейдёт на Supabase auth для CRM — сюда добавим проверку роли.
drop policy if exists salon_settings_write on public.salon_settings;
create policy salon_settings_write on public.salon_settings
  for all using (true) with check (true);

-- ------------------------------------------------------------------
-- 3. Триггер на обновление updated_at.
-- ------------------------------------------------------------------
create or replace function public.salon_settings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_salon_settings_updated on public.salon_settings;
create trigger trg_salon_settings_updated
before update on public.salon_settings
for each row execute function public.salon_settings_touch_updated_at();
