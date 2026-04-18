-- 032_site_pages_styles_status.sql
--
-- Лендинг (site-builder.mjs) и CRM (SiteBuilderPage.tsx) запрашивают у
-- public.site_pages колонки styles (jsonb) и status (text), которых там
-- никогда не было. На проде это даёт 400 Bad Request от PostgREST
-- (видно в DevTools на alessannailu.com), а в TypeScript/CRM —
-- "Property 'status' / 'styles' does not exist on type 'SitePageRow'".
--
-- Добавляем обе колонки идемпотентно. Дефолты подобраны так, чтобы
-- существующие страницы автоматически попадали в выборку
-- `status = 'published'`.

alter table public.site_pages add column if not exists styles jsonb not null default '{}'::jsonb;
alter table public.site_pages add column if not exists status text not null default 'published';

-- На случай если кто-то уже SQL-руками вставлял строки без статуса —
-- проставим 'published'.
update public.site_pages set status = 'published' where status is null or status = '';

-- Чтобы фильтр `status = 'published'` оставался быстрым на росте таблицы.
create index if not exists site_pages_slug_status_idx on public.site_pages(slug, status);
