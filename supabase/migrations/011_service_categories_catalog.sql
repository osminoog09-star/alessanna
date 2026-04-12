-- Website + unified service catalog (UUID, numeric price, simple name/duration).
-- Spec asked for table name `services`; this project already has public.services (bigint, CRM).
-- New data lives in service_listings until a follow-up migration retires legacy services + renames.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Categories (UUID) — requested name: service_categories
-- ---------------------------------------------------------------------------
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_categories_sort on public.service_categories (sort_order, name);

-- ---------------------------------------------------------------------------
-- Services catalog (UUID) — same columns as spec; table name service_listings
-- to avoid conflict with existing public.services (bigint).
-- ---------------------------------------------------------------------------
create table if not exists public.service_listings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric,
  duration int,
  category_id uuid references public.service_categories (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_listings_category on public.service_listings (category_id);
create index if not exists idx_service_listings_active on public.service_listings (is_active) where is_active = true;

-- ---------------------------------------------------------------------------
-- RLS (permissive — align with rest of salon migrations / anon CRM key)
-- ---------------------------------------------------------------------------
alter table public.service_categories enable row level security;
alter table public.service_listings enable row level security;

drop policy if exists "service_categories_all" on public.service_categories;
create policy "service_categories_all"
  on public.service_categories
  for all
  using (true)
  with check (true);

drop policy if exists "service_listings_all" on public.service_listings;
create policy "service_listings_all"
  on public.service_listings
  for all
  using (true)
  with check (true);
