-- 033_crm_legacy_columns.sql
--
-- Реальный аудит CRM на work.alessannailu.com показал, что фронт CRM (Vite/React)
-- стучится в legacy-схему, которой в БД сейчас просто нет:
--
--   GET /rest/v1/categories                      → 404 (таблица отсутствует)
--   GET /rest/v1/services?select=*&active=eq.true → 400 (нет колонки `active`)
--   GET /rest/v1/services?select=id,name_et      → 400 (нет колонки `name_et`)
--   GET /rest/v1/appointments?select=*&status=neq.cancelled → 400 (нет колонки `status`)
--
-- Эти ошибки сыпались на каждой загрузке страниц Calendar / Bookings / Services /
-- Analytics / Finance / Dashboard и захламляли DevTools. Сами страницы при этом
-- молча работали через новую схему (service_listings / service_categories), но
-- сетевой шум скрывал реальные проблемы и нагружал Postgres.
--
-- Решение — добавить недостающие legacy-колонки/таблицу. Это ничего не ломает,
-- так как CRM умеет fallback'ить с legacy на новую схему: сейчас просто 4xx
-- сменится на 200 OK + пустые/корректные данные.

-- 1. Колонка appointments.status (используется в Calendar / Analytics / Bookings /
--    Finance / Dashboard / lib/calendarBlocks). Дефолт 'confirmed' — то же значение,
--    что код подставлял на клиенте.
alter table public.appointments add column if not exists status text not null default 'confirmed';
create index if not exists appointments_status_idx on public.appointments(status);

-- 2. Колонки services.name_et / active / sort_order (используются в Services /
--    Calendar / Analytics / AdminStaffPage). Это устаревшая «двуязычная» legacy-таблица;
--    данные продолжают жить в service_listings, но запросы к services не должны падать.
alter table public.services add column if not exists name_et    text null;
alter table public.services add column if not exists active     boolean not null default true;
alter table public.services add column if not exists sort_order integer not null default 0;
-- Заполняем name_et для существующих legacy-строк, чтобы UI Services показывал имя.
update public.services set name_et = name where name_et is null and name is not null;

-- 3. Таблица categories (legacy alias для service_categories). 100+ 404 за сессию.
--    ВАЖНО: схему ОБЯЗАТЕЛЬНО держим как в 002_salon_crm.sql — bigint identity,
--    потому что 002 уже создал FK
--      services.category_id bigint references categories(id)
--    Если бы мы создавали тут UUID-таблицу, на свежей БД (без 002) FK в
--    services.category_id отвалился бы по type-mismatch, а на старой БД (с 002)
--    `create table if not exists` тихо пропускался — то есть UUID-намерение
--    миграции никогда бы не реализовалось, а схема оставалась бы непредсказуемой.
--    Поэтому здесь — bigint identity, и доводим on-disk таблицу до этой формы
--    идемпотентно (если её кто-то ранее создал руками с другой колонкой/типом).
create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Догоняем существующую таблицу до ожидаемой формы (на старых проектах,
-- где её ставили вручную, могут отсутствовать колонки — без них фронт ServicesPage
-- падает на insert/update). Тип id не меняем — это сломало бы FK services.category_id.
alter table public.categories add column if not exists name       text;
alter table public.categories add column if not exists created_at timestamptz not null default now();
update public.categories set name = '' where name is null;
alter table public.categories alter column name set not null;

-- 4. Подстраховка: даём anon обычные RLS-права (CRM ходит anon-ключом, как и
--    остальные таблицы). Иначе выйдет либо 401, либо PostgREST скроет таблицу.
alter table public.categories enable row level security;
drop policy if exists categories_open_all on public.categories;
create policy categories_open_all on public.categories for all to public using (true) with check (true);
