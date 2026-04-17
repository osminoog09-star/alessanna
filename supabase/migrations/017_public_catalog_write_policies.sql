-- Allow CRM (anon/authenticated client) to manage public catalog tables.
-- Without these policies category/service creation fails under RLS.

alter table if exists public.service_categories enable row level security;
alter table if exists public.service_listings enable row level security;
alter table if exists public.services enable row level security;

drop policy if exists service_categories_public_write on public.service_categories;
create policy service_categories_public_write
  on public.service_categories
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists service_listings_public_write on public.service_listings;
create policy service_listings_public_write
  on public.service_listings
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists services_public_write on public.services;
create policy services_public_write
  on public.services
  for all
  to anon, authenticated
  using (true)
  with check (true);
