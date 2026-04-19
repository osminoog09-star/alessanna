-- 044_analytics_views.sql
-- ============================================================================
-- P1: Аналитика — переиспользуемые SQL-views для дашборда и отчётов.
--
-- Идея: вынести в БД часто-нужные расчёты (выручка, средний чек, топ услуг
-- и мастеров за период) — чтобы фронту не приходилось каждый раз тащить
-- сырые appointments и считать в JS, и чтобы было удобно делать ad-hoc
-- запросы из SQL Editor.
-- ============================================================================

-- 1. Денормализованный view: запись + цена + длительность из service_listings
--    (с fallback на legacy services). Цена в центах, как везде.
create or replace view public.appointments_enriched as
  select
    a.id,
    a.staff_id,
    a.client_id,
    a.client_name,
    a.client_phone,
    a.client_email,
    a.start_time,
    a.end_time,
    a.status,
    a.note,
    a.created_at,
    a.service_id,
    coalesce(sl.name, ls.name_et) as service_name,
    coalesce(round((sl.price * 100)::numeric, 0)::int, ls.price_cents, 0) as price_cents,
    coalesce(sl.duration, ls.duration_min, 60) as duration_min,
    coalesce(sl.buffer_after_min, ls.buffer_after_min, 0) as buffer_after_min
  from public.appointments a
  left join public.service_listings sl on sl.id = a.service_id
  left join public.services ls on ls.id::text = a.service_id::text;

comment on view public.appointments_enriched is
  'Записи + цена/длительность услуги (service_listings приоритет, services fallback).';

-- 2. Дневная агрегация выручки и записей.
create or replace view public.analytics_daily as
  select
    date_trunc('day', a.start_time)::date as day,
    count(*) filter (where a.status <> 'cancelled') as appointments_count,
    count(*) filter (where a.status = 'cancelled') as cancellations_count,
    coalesce(sum(a.price_cents) filter (where a.status <> 'cancelled'), 0) as revenue_cents,
    coalesce(avg(a.price_cents) filter (where a.status <> 'cancelled'), 0)::bigint as avg_check_cents
  from public.appointments_enriched a
  where a.start_time is not null
  group by 1
  order by 1 desc;

comment on view public.analytics_daily is
  'Выручка и количество записей по дням. Используй where day >= now() - interval ''N days''.';

-- 3. Топ услуг за последние 30 / 90 дней.
create or replace view public.analytics_top_services_30d as
  select
    a.service_id,
    a.service_name,
    count(*) as bookings,
    sum(a.price_cents) as revenue_cents
  from public.appointments_enriched a
  where a.status <> 'cancelled'
    and a.start_time >= now() - interval '30 days'
    and a.service_id is not null
  group by a.service_id, a.service_name
  order by revenue_cents desc;

create or replace view public.analytics_top_services_90d as
  select
    a.service_id,
    a.service_name,
    count(*) as bookings,
    sum(a.price_cents) as revenue_cents
  from public.appointments_enriched a
  where a.status <> 'cancelled'
    and a.start_time >= now() - interval '90 days'
    and a.service_id is not null
  group by a.service_id, a.service_name
  order by revenue_cents desc;

-- 4. Загрузка мастеров (по выручке/часам) за 30 дней.
create or replace view public.analytics_staff_load_30d as
  select
    s.id as staff_id,
    s.name as staff_name,
    count(*) filter (where a.status <> 'cancelled') as appointments_count,
    coalesce(sum((a.duration_min + a.buffer_after_min)::numeric / 60.0)
             filter (where a.status <> 'cancelled'), 0) as billed_hours,
    coalesce(sum(a.price_cents) filter (where a.status <> 'cancelled'), 0) as revenue_cents
  from public.staff s
  left join public.appointments_enriched a
    on a.staff_id = s.id
   and a.start_time >= now() - interval '30 days'
  where s.is_active = true
  group by s.id, s.name
  order by revenue_cents desc;

-- 5. KPI «сегодня / неделя / месяц» — однострочный view для блока на дашборде.
create or replace view public.analytics_kpi_now as
  select
    -- Сегодня
    (select count(*) from public.appointments
       where start_time::date = current_date and status <> 'cancelled') as today_count,
    (select coalesce(sum(price_cents), 0) from public.appointments_enriched
       where start_time::date = current_date and status <> 'cancelled') as today_revenue_cents,
    -- Эта неделя (Пн..Вс по серверной TZ)
    (select count(*) from public.appointments
       where start_time >= date_trunc('week', current_date)
         and start_time < date_trunc('week', current_date) + interval '7 days'
         and status <> 'cancelled') as week_count,
    (select coalesce(sum(price_cents), 0) from public.appointments_enriched
       where start_time >= date_trunc('week', current_date)
         and start_time < date_trunc('week', current_date) + interval '7 days'
         and status <> 'cancelled') as week_revenue_cents,
    -- 30 дней назад → сейчас
    (select count(*) from public.appointments
       where start_time >= now() - interval '30 days' and status <> 'cancelled') as month_count,
    (select coalesce(sum(price_cents), 0) from public.appointments_enriched
       where start_time >= now() - interval '30 days' and status <> 'cancelled') as month_revenue_cents,
    (select coalesce(avg(price_cents), 0)::bigint from public.appointments_enriched
       where start_time >= now() - interval '30 days' and status <> 'cancelled') as month_avg_check_cents,
    (select count(*) from public.appointments
       where status = 'cancelled' and start_time >= now() - interval '30 days') as month_cancelled,
    -- Очередь email
    (select count(*) from public.email_jobs where status = 'pending' and scheduled_at <= now()) as email_due,
    (select count(*) from public.email_jobs where status = 'failed') as email_failed,
    -- Low-stock материалов
    (select count(*) from public.inventory_items
       where is_active = true and low_stock_threshold is not null and on_hand <= low_stock_threshold) as low_stock_count;

comment on view public.analytics_kpi_now is
  'Однострочный KPI snapshot для виджетов на дашборде. Один вызов = одна цифра на карточку.';
