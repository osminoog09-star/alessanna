-- Ensure public landing can read service catalog via anon key.
-- Symptom: CRM sees services, but site-services.mjs gets empty arrays from anon queries.

alter table if exists public.service_categories enable row level security;
alter table if exists public.service_listings enable row level security;
alter table if exists public.services enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'service_categories'
      and policyname = 'service_categories_public_read'
  ) then
    create policy service_categories_public_read
      on public.service_categories
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'service_listings'
      and policyname = 'service_listings_public_read'
  ) then
    create policy service_listings_public_read
      on public.service_listings
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'services'
      and policyname = 'services_public_read'
  ) then
    create policy services_public_read
      on public.services
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;
