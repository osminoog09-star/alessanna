-- 034_services_analytics_columns.sql
--
-- Финальный остаток после миграции 033: AnalyticsPage.tsx запрашивает у legacy-
-- таблицы services дополнительные «новые» колонки price_cents / duration_min /
-- buffer_after_min — их там никогда не было, отсюда 400 в Network.
--
--   GET /rest/v1/services?select=id,name_et,price_cents,duration_min,buffer_after_min
--
-- Добавляем колонки идемпотентно. Существующие данные конвертируем:
--   price (numeric €)  -> price_cents (int, ×100)
--   duration (минуты)  -> duration_min (то же значение)
-- buffer_after_min не существовал в legacy — даём дефолт 10 (как в service_listings).

alter table public.services add column if not exists price_cents      integer null;
alter table public.services add column if not exists duration_min     integer null;
alter table public.services add column if not exists buffer_after_min integer not null default 10;

update public.services set price_cents = (price * 100)::integer where price_cents is null and price is not null;
update public.services set duration_min = duration         where duration_min is null and duration is not null;
