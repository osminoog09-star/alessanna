-- Multi-service appointments: lines live in appointment_services; appointments = visit header.

create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id bigint not null references public.services (id) on delete restrict,
  staff_id uuid not null references public.staff (id) on delete restrict,
  start_time timestamptz not null,
  end_time timestamptz not null
);

create index if not exists idx_appointment_services_staff_start
  on public.appointment_services (staff_id, start_time);
create index if not exists idx_appointment_services_appointment
  on public.appointment_services (appointment_id);

-- Migrate existing single-service rows
insert into public.appointment_services (id, appointment_id, service_id, staff_id, start_time, end_time)
select gen_random_uuid(), a.id, a.service_id, a.staff_id, a.start_time, a.end_time
from public.appointments a
where not exists (
  select 1 from public.appointment_services x where x.appointment_id = a.id
);

drop index if exists public.idx_appointments_staff_start;

alter table public.appointments drop constraint if exists appointments_staff_id_fkey;
alter table public.appointments drop constraint if exists appointments_service_id_fkey;

alter table public.appointments drop column if exists staff_id;
alter table public.appointments drop column if exists service_id;
alter table public.appointments drop column if exists start_time;
alter table public.appointments drop column if exists end_time;

alter table public.appointment_services enable row level security;
drop policy if exists "appointment_services_all" on public.appointment_services;
create policy "appointment_services_all" on public.appointment_services for all using (true) with check (true);
