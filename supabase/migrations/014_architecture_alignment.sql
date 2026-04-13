-- Align DB schema with ARCHITECTURE.md only (no extra guessed fields).
-- Idempotent migration.

create extension if not exists "pgcrypto";

-- STAFF
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  role text not null default 'worker',
  is_active boolean not null default true,
  work_type text not null default 'percentage',
  percent_rate numeric,
  rent_per_day numeric
);
alter table public.staff add column if not exists id uuid default gen_random_uuid();
alter table public.staff add column if not exists name text;
alter table public.staff add column if not exists phone text;
alter table public.staff add column if not exists role text;
alter table public.staff add column if not exists is_active boolean;
alter table public.staff add column if not exists work_type text;
alter table public.staff add column if not exists percent_rate numeric;
alter table public.staff add column if not exists rent_per_day numeric;
update public.staff set role = coalesce(role, 'worker');
update public.staff set is_active = coalesce(is_active, true);
update public.staff set work_type = coalesce(work_type, 'percentage');
alter table public.staff alter column name set not null;
alter table public.staff alter column role set not null;
alter table public.staff alter column is_active set not null;
alter table public.staff alter column work_type set not null;
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('owner', 'admin', 'manager', 'worker'));
alter table public.staff drop constraint if exists staff_work_type_check;
alter table public.staff add constraint staff_work_type_check check (work_type in ('percentage', 'rent'));

-- CLIENTS
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);
alter table public.clients add column if not exists id uuid default gen_random_uuid();
alter table public.clients add column if not exists name text;
alter table public.clients add column if not exists phone text;
alter table public.clients add column if not exists created_at timestamptz not null default now();
alter table public.clients alter column name set not null;
create unique index if not exists uq_clients_phone_digits
  on public.clients (phone)
  where phone is not null and phone <> '';

-- APPOINTMENTS
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid,
  created_at timestamptz not null default now()
);
alter table public.appointments add column if not exists id uuid default gen_random_uuid();
alter table public.appointments add column if not exists client_id uuid;
alter table public.appointments add column if not exists created_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_client_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_client_id_fkey
      foreign key (client_id) references public.clients (id) on delete set null;
  end if;
end $$;

-- SERVICE_CATEGORIES
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
alter table public.service_categories add column if not exists id uuid default gen_random_uuid();
alter table public.service_categories add column if not exists name text;
alter table public.service_categories alter column name set not null;

-- SERVICES (use service_listings as active services table)
create table if not exists public.service_listings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric,
  duration int,
  category_id uuid
);
alter table public.service_listings add column if not exists id uuid default gen_random_uuid();
alter table public.service_listings add column if not exists name text;
alter table public.service_listings add column if not exists price numeric;
alter table public.service_listings add column if not exists duration int;
alter table public.service_listings add column if not exists category_id uuid;
alter table public.service_listings alter column name set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_listings_category_id_fkey'
      and conrelid = 'public.service_listings'::regclass
  ) then
    alter table public.service_listings
      add constraint service_listings_category_id_fkey
      foreign key (category_id) references public.service_categories (id) on delete set null;
  end if;
end $$;

-- STAFF_SCHEDULE
create table if not exists public.staff_schedule (
  staff_id uuid not null,
  day_of_week int not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time time not null,
  end_time time not null
);
alter table public.staff_schedule add column if not exists staff_id uuid;
alter table public.staff_schedule add column if not exists day_of_week int;
alter table public.staff_schedule add column if not exists start_time time;
alter table public.staff_schedule add column if not exists end_time time;
alter table public.staff_schedule alter column staff_id set not null;
alter table public.staff_schedule alter column day_of_week set not null;
alter table public.staff_schedule alter column start_time set not null;
alter table public.staff_schedule alter column end_time set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_schedule_staff_id_fkey'
      and conrelid = 'public.staff_schedule'::regclass
  ) then
    alter table public.staff_schedule
      add constraint staff_schedule_staff_id_fkey
      foreign key (staff_id) references public.staff (id) on delete cascade;
  end if;
end $$;

-- STAFF_TIME_OFF
create table if not exists public.staff_time_off (
  staff_id uuid not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  time_off_type text not null default 'manual_block'
);
alter table public.staff_time_off add column if not exists staff_id uuid;
alter table public.staff_time_off add column if not exists start_time timestamptz;
alter table public.staff_time_off add column if not exists end_time timestamptz;
alter table public.staff_time_off add column if not exists time_off_type text;
update public.staff_time_off set time_off_type = coalesce(time_off_type, 'manual_block');
alter table public.staff_time_off alter column staff_id set not null;
alter table public.staff_time_off alter column start_time set not null;
alter table public.staff_time_off alter column end_time set not null;
alter table public.staff_time_off alter column time_off_type set not null;
alter table public.staff_time_off drop constraint if exists staff_time_off_time_off_type_check;
alter table public.staff_time_off
  add constraint staff_time_off_time_off_type_check
  check (time_off_type in ('sick_leave', 'day_off', 'manual_block'));
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_time_off_staff_id_fkey'
      and conrelid = 'public.staff_time_off'::regclass
  ) then
    alter table public.staff_time_off
      add constraint staff_time_off_staff_id_fkey
      foreign key (staff_id) references public.staff (id) on delete cascade;
  end if;
end $$;

-- STAFF_WORK_DAYS
create table if not exists public.staff_work_days (
  staff_id uuid not null,
  date date not null,
  is_working boolean not null default true
);
alter table public.staff_work_days add column if not exists staff_id uuid;
alter table public.staff_work_days add column if not exists date date;
alter table public.staff_work_days add column if not exists is_working boolean;
update public.staff_work_days set is_working = coalesce(is_working, true);
alter table public.staff_work_days alter column staff_id set not null;
alter table public.staff_work_days alter column date set not null;
alter table public.staff_work_days alter column is_working set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_work_days_staff_id_fkey'
      and conrelid = 'public.staff_work_days'::regclass
  ) then
    alter table public.staff_work_days
      add constraint staff_work_days_staff_id_fkey
      foreign key (staff_id) references public.staff (id) on delete cascade;
  end if;
end $$;

-- APPOINTMENT_SERVICES (calendar source)
create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  start_time timestamptz not null,
  end_time timestamptz not null
);
alter table public.appointment_services add column if not exists id uuid default gen_random_uuid();
alter table public.appointment_services add column if not exists appointment_id uuid;
alter table public.appointment_services add column if not exists service_id uuid;
alter table public.appointment_services add column if not exists staff_id uuid;
alter table public.appointment_services add column if not exists start_time timestamptz;
alter table public.appointment_services add column if not exists end_time timestamptz;
alter table public.appointment_services alter column appointment_id set not null;
alter table public.appointment_services alter column service_id set not null;
alter table public.appointment_services alter column staff_id set not null;
alter table public.appointment_services alter column start_time set not null;
alter table public.appointment_services alter column end_time set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_services_appointment_id_fkey'
      and conrelid = 'public.appointment_services'::regclass
  ) then
    alter table public.appointment_services
      add constraint appointment_services_appointment_id_fkey
      foreign key (appointment_id) references public.appointments (id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_services_staff_id_fkey'
      and conrelid = 'public.appointment_services'::regclass
  ) then
    alter table public.appointment_services
      add constraint appointment_services_staff_id_fkey
      foreign key (staff_id) references public.staff (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_services_service_id_fkey'
      and conrelid = 'public.appointment_services'::regclass
  ) then
    alter table public.appointment_services
      add constraint appointment_services_service_id_fkey
      foreign key (service_id) references public.service_listings (id) on delete restrict;
  end if;
end $$;


