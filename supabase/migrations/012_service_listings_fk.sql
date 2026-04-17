-- Point CRM/booking FKs at service_listings (uuid) and migrate data from legacy
-- public.services (bigint) + public.categories when present.
--
-- NOTE: bare `select ... from public.categories` / `from public.services` fails at
-- parse time on databases where those legacy tables don't exist (42P01), even if
-- the WHERE guard would skip execution. We wrap those legacy-data inserts in
-- dynamic SQL (`EXECUTE`) so the parser sees them only when the tables exist.

create extension if not exists pgcrypto;

alter table public.service_listings add column if not exists buffer_after_min int not null default 10;
alter table public.service_listings add column if not exists sort_order int not null default 0;

alter table public.service_categories add column if not exists _migrated_from bigint;
create unique index if not exists uq_service_categories_migrated_from
  on public.service_categories (_migrated_from)
  where _migrated_from is not null;

alter table public.service_listings add column if not exists _migrated_from bigint;
create unique index if not exists uq_service_listings_migrated_from
  on public.service_listings (_migrated_from)
  where _migrated_from is not null;

-- Categories: legacy bigint -> service_categories (only if legacy table exists)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'categories'
  ) then
    execute $sql$
      insert into public.service_categories (name, sort_order, _migrated_from)
      select c.name, 0, c.id
      from public.categories c
      where not exists (
        select 1 from public.service_categories sc where sc._migrated_from = c.id
      )
    $sql$;
  end if;
end $$;

-- Services: legacy -> service_listings (only if legacy table + required columns exist)
do $$
declare
  has_services boolean;
  has_name_et  boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'services'
  ) into has_services;

  if not has_services then
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'services' and column_name = 'name_et'
  ) into has_name_et;

  if not has_name_et then
    return;
  end if;

  execute $sql$
    insert into public.service_listings (
      name, price, duration, category_id, is_active, sort_order, buffer_after_min, _migrated_from
    )
    select
      s.name_et,
      (s.price_cents::numeric / 100.0),
      s.duration_min,
      (select sc.id from public.service_categories sc where sc._migrated_from = s.category_id limit 1),
      coalesce(s.active, true),
      coalesce(s.sort_order, 0),
      coalesce(s.buffer_after_min, 10),
      s.id
    from public.services s
    where not exists (
      select 1 from public.service_listings sl where sl._migrated_from = s.id
    )
  $sql$;
end $$;

-- appointment_services.service_id: bigint -> uuid
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointment_services'
      and column_name = 'service_id' and udt_name = 'int8'
  ) then
    alter table public.appointment_services drop constraint if exists appointment_services_service_id_fkey;
    alter table public.appointment_services
      alter column service_id type uuid using (
        (select sl.id from public.service_listings sl where sl._migrated_from = appointment_services.service_id limit 1)
      );
    alter table public.appointment_services
      add constraint appointment_services_service_id_fkey
      foreign key (service_id) references public.service_listings (id) on delete restrict;
  end if;
end $$;

-- staff_services.service_id: bigint -> uuid
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_services'
      and column_name = 'service_id' and udt_name = 'int8'
  ) then
    alter table public.staff_services drop constraint if exists staff_services_pkey;
    alter table public.staff_services drop constraint if exists staff_services_staff_id_fkey;
    alter table public.staff_services drop constraint if exists staff_services_service_id_fkey;
    alter table public.staff_services
      alter column service_id type uuid using (
        (select sl.id from public.service_listings sl where sl._migrated_from = staff_services.service_id limit 1)
      );
    alter table public.staff_services add primary key (staff_id, service_id);
    alter table public.staff_services
      add constraint staff_services_staff_id_fkey
      foreign key (staff_id) references public.staff (id) on delete cascade;
    alter table public.staff_services
      add constraint staff_services_service_id_fkey
      foreign key (service_id) references public.service_listings (id) on delete cascade;
  end if;
end $$;

alter table public.service_categories drop column if exists _migrated_from;
alter table public.service_listings drop column if exists _migrated_from;

drop index if exists uq_service_categories_migrated_from;
drop index if exists uq_service_listings_migrated_from;
