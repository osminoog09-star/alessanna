-- Site builder MVP: pages + blocks (additive only).

create extension if not exists "pgcrypto";

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.site_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages (id) on delete cascade,
  type text not null check (type in ('button', 'text', 'section')),
  content jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_site_blocks_page_position
  on public.site_blocks (page_id, position, created_at);

alter table public.site_pages enable row level security;
alter table public.site_blocks enable row level security;

drop policy if exists "site_pages_all" on public.site_pages;
create policy "site_pages_all" on public.site_pages for all using (true) with check (true);

drop policy if exists "site_blocks_all" on public.site_blocks;
create policy "site_blocks_all" on public.site_blocks for all using (true) with check (true);

