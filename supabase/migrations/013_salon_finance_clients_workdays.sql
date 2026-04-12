-- Staff compensation, work-day tracking, clients, time-off types, appointment→client link.
-- Future: payments + notifications (see comments on public.appointments).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Staff: percentage vs rent
-- ---------------------------------------------------------------------------
alter table public.staff add column if not exists work_type text
  check (work_type is null or work_type in ('percentage', 'rent'));
alter table public.staff add column if not exists percent_rate numeric;
alter table public.staff add column if not exists rent_per_day numeric;

update public.staff set work_type = 'percentage' where work_type is null;

-- ---------------------------------------------------------------------------
-- Clients (visit history / CRM)
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_clients_phone_digits
  on public.clients (phone)
  where phone is not null and phone <> '';

-- ---------------------------------------------------------------------------
-- Appointments → client (nullable for legacy rows)
-- ---------------------------------------------------------------------------
alter table public.appointments add column if not exists client_id uuid references public.clients (id) on delete set null;

create index if not exists idx_appointments_client on public.appointments (client_id);

comment on column public.appointments.client_id is 'Linked client profile; future: payments/notifications.';

-- ---------------------------------------------------------------------------
-- Time off: typed blocks (sick leave, day off, manual)
-- ---------------------------------------------------------------------------
alter table public.staff_time_off add column if not exists time_off_type text
  not null default 'manual_block'
  check (time_off_type in ('sick_leave', 'day_off', 'manual_block'));

update public.staff_time_off set time_off_type = 'manual_block' where time_off_type is null;

-- ---------------------------------------------------------------------------
-- Working days (rent calculation + attendance)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_work_days (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  date date not null,
  is_working boolean not null default true,
  created_at timestamptz not null default now(),
  unique (staff_id, date)
);

create index if not exists idx_staff_work_days_staff_month on public.staff_work_days (staff_id, date);

-- When a service line is booked, mark that calendar day as a working day for that staff member.
create or replace function public.touch_staff_work_day_from_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_work_days (staff_id, date, is_working)
  values (
    new.staff_id,
    (new.start_time at time zone 'UTC')::date,
    true
  )
  on conflict (staff_id, date) do update
    set is_working = excluded.is_working;
  return new;
end;
$$;

drop trigger if exists trg_appointment_services_staff_work_day on public.appointment_services;
create trigger trg_appointment_services_staff_work_day
  after insert on public.appointment_services
  for each row
  execute function public.touch_staff_work_day_from_line();

-- ---------------------------------------------------------------------------
-- RLS (match permissive salon pattern)
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.staff_work_days enable row level security;

drop policy if exists "clients_all" on public.clients;
create policy "clients_all" on public.clients for all using (true) with check (true);

drop policy if exists "staff_work_days_all" on public.staff_work_days;
create policy "staff_work_days_all" on public.staff_work_days for all using (true) with check (true);
