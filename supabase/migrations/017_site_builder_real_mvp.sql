-- Real site builder MVP:
-- - draft/published page versions
-- - page typography styles
-- - per-block styles
-- - richer block types

alter table public.site_pages
  add column if not exists status text;

update public.site_pages
set status = 'published'
where status is null;

alter table public.site_pages
  alter column status set default 'draft';

alter table public.site_pages
  alter column status set not null;

alter table public.site_pages
  add column if not exists styles jsonb not null default '{}'::jsonb;

alter table public.site_pages
  add column if not exists updated_at timestamptz not null default now();

alter table public.site_pages
  add column if not exists published_at timestamptz;

alter table public.site_pages drop constraint if exists site_pages_status_check;
alter table public.site_pages
  add constraint site_pages_status_check
  check (status in ('draft', 'published'));

alter table public.site_pages drop constraint if exists site_pages_slug_key;

create unique index if not exists site_pages_slug_status_uniq
  on public.site_pages (slug, status);

alter table public.site_blocks
  add column if not exists styles jsonb not null default '{}'::jsonb;

alter table public.site_blocks
  add column if not exists updated_at timestamptz not null default now();

alter table public.site_blocks drop constraint if exists site_blocks_type_check;
alter table public.site_blocks
  add constraint site_blocks_type_check
  check (type in ('button', 'text', 'section', 'image', 'spacer'));

create index if not exists idx_site_pages_slug_status
  on public.site_pages (slug, status);

