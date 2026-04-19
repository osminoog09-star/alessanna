-- 040_db_hygiene_fk_indexes_and_search_path.sql
-- Гигиена БД (не меняет поведение приложения):
--   1. Индексы на foreign keys без покрывающего индекса (13 шт.).
--   2. Явный search_path для тех функций, где он сейчас mutable
--      (advisor 0011_function_search_path_mutable). Без этого SECURITY
--      DEFINER функции теоретически могут быть атакованы через
--      перенаправление через схему злоумышленника.
--   3. Явные deny-all RLS-политики на support_threads / support_messages —
--      сейчас RLS включена, но политик нет, поэтому даже SELECT через
--      anon/authenticated `.from(...)` всегда возвращает []. Это корректное
--      поведение (мы ходим только через support_staff_* SECURITY DEFINER
--      RPC), но advisor выдаёт INFO «RLS Enabled No Policy». Явные
--      deny-all политики делают намерение видимым в DDL и снимают шум.
-- НЕ ТРОГАЕМ:
--   * RLS-политики USING (true) на staff/appointments/services и т.д. —
--     сейчас CRM ходит как anon, и закрытие RLS сломает её. Это требует
--     архитектурного решения (переход на Supabase Auth или RPC-only
--     паттерн) — обсуждаем отдельно.
--   * Неиспользуемые индексы из advisor — могут понадобиться для редких
--     запросов, удалять без подтверждения опасно.

------------------------------------------------------------------------
-- 1. INDEXES ON FOREIGN KEYS
------------------------------------------------------------------------
create index if not exists appointment_services_appointment_id_idx
  on public.appointment_services (appointment_id);
create index if not exists appointment_services_service_id_idx
  on public.appointment_services (service_id);
create index if not exists appointment_services_staff_id_idx
  on public.appointment_services (staff_id);

create index if not exists appointments_client_id_idx
  on public.appointments (client_id);
create index if not exists appointments_service_id_idx
  on public.appointments (service_id);
create index if not exists appointments_staff_id_idx
  on public.appointments (staff_id);

create index if not exists service_listings_category_id_idx
  on public.service_listings (category_id);

create index if not exists staff_schedule_staff_id_idx
  on public.staff_schedule (staff_id);

create index if not exists staff_services_service_id_idx
  on public.staff_services (service_id);
create index if not exists staff_services_staff_id_idx
  on public.staff_services (staff_id);

create index if not exists staff_time_off_staff_id_idx
  on public.staff_time_off (staff_id);

create index if not exists support_messages_sender_staff_id_idx
  on public.support_messages (sender_staff_id);
create index if not exists support_threads_assigned_by_staff_id_idx
  on public.support_threads (assigned_by_staff_id);

------------------------------------------------------------------------
-- 2. SEARCH_PATH FOR SECURITY-SENSITIVE FUNCTIONS
------------------------------------------------------------------------
alter function public.google_oauth_tokens_touch_updated_at() set search_path = public;
alter function public.notifications_outbox_touch_updated_at() set search_path = public;
alter function public._support_topic_prefix(text) set search_path = public;

------------------------------------------------------------------------
-- 3. EXPLICIT DENY-ALL POLICIES FOR SUPPORT TABLES
-- Доступ строго через SECURITY DEFINER RPC (support_staff_*).
------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.support_threads'::regclass
      and polname  = 'support_threads_no_direct_access'
  ) then
    create policy support_threads_no_direct_access
      on public.support_threads
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.support_messages'::regclass
      and polname  = 'support_messages_no_direct_access'
  ) then
    create policy support_messages_no_direct_access
      on public.support_messages
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
