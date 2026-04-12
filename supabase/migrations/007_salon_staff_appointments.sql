-- Salon CRM: staff-centric schema, schedules, time off, appointments.
-- Run after 001 (services). If `staff` already exists with a different shape, align manually before applying FKs.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core: staff (UUID). Skip creation if you already have a compatible table.
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  phone text,
  name text not null,
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_staff_active on public.staff (is_active);

-- ---------------------------------------------------------------------------
-- staff_schedule (weekly hours)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_schedule (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  day_of_week int not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time time not null,
  end_time time not null
);

create index if not exists idx_staff_schedule_staff on public.staff_schedule (staff_id);

-- ---------------------------------------------------------------------------
-- staff_time_off
-- ---------------------------------------------------------------------------
create table if not exists public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  reason text
);

create index if not exists idx_staff_time_off_staff_start on public.staff_time_off (staff_id, start_time);

-- ---------------------------------------------------------------------------
-- staff_services (which staff offers which service)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_services (
  staff_id uuid not null references public.staff (id) on delete cascade,
  service_id bigint not null references public.services (id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ---------------------------------------------------------------------------
-- appointments (replaces legacy `bookings` for new CRM)
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete restrict,
  service_id bigint not null references public.services (id) on delete restrict,
  client_name text not null,
  client_phone text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  source text not null default 'online' check (source in ('online', 'manual')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appointments_staff_start on public.appointments (staff_id, start_time);
create index if not exists idx_appointments_status on public.appointments (status);

-- ---------------------------------------------------------------------------
-- Phone login RPC → staff row as JSON
-- ---------------------------------------------------------------------------
create or replace function public.verify_staff_phone(phone_input text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  norm text;
  row json;
begin
  norm := regexp_replace(coalesce(phone_input, ''), '\D', '', 'g');
  if norm = '' then
    return null;
  end if;
  select to_json(s.*) into row
  from staff s
  where regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = norm
    and s.is_active = true
  limit 1;
  return row;
end;
$$;

grant execute on function public.verify_staff_phone(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS (permissive policies for anon key + frontend enforcement)
-- ---------------------------------------------------------------------------
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.staff_services enable row level security;
alter table public.staff_schedule enable row level security;
alter table public.staff_time_off enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "staff_select_all" on public.staff;
create policy "staff_select_all" on public.staff for select using (true);
drop policy if exists "staff_write_all" on public.staff;
create policy "staff_write_all" on public.staff for all using (true) with check (true);

drop policy if exists "services_select_all" on public.services;
create policy "services_select_all" on public.services for select using (true);
drop policy if exists "services_write_all" on public.services;
create policy "services_write_all" on public.services for all using (true) with check (true);

drop policy if exists "staff_services_all" on public.staff_services;
create policy "staff_services_all" on public.staff_services for all using (true) with check (true);

drop policy if exists "staff_schedule_all" on public.staff_schedule;
create policy "staff_schedule_all" on public.staff_schedule for all using (true) with check (true);

drop policy if exists "staff_time_off_all" on public.staff_time_off;
create policy "staff_time_off_all" on public.staff_time_off for all using (true) with check (true);

drop policy if exists "appointments_all" on public.appointments;
create policy "appointments_all" on public.appointments for all using (true) with check (true);
