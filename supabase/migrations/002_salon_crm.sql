-- Alessanna CRM: categories, schedules, earnings, employee payroll fields,
-- appointment_at on bookings, RLS (permissive for dev — tighten in production),
-- realtime, phone login RPC, reminder tracking.

create table if not exists categories (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table employees
  add column if not exists role text not null default 'employee'
    check (role in ('admin', 'manager', 'employee'));

alter table employees
  add column if not exists payroll_type text not null default 'percent'
    check (payroll_type in ('percent', 'fixed'));

alter table employees
  add column if not exists commission numeric(6, 2) not null default 0;

alter table employees
  add column if not exists fixed_salary numeric(12, 2) not null default 0;

alter table services
  add column if not exists category_id bigint references categories (id) on delete set null;

alter table bookings
  add column if not exists client_phone text;

alter table bookings
  add column if not exists appointment_at timestamptz;

-- Optional backfill (uncomment if start_at stores ISO timestamps):
-- update bookings set appointment_at = start_at::timestamptz
-- where appointment_at is null and start_at is not null;

create table if not exists schedules (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees (id) on delete cascade,
  day smallint not null check (day >= 0 and day <= 6),
  start_time time not null,
  end_time time not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  created_at timestamptz not null default now()
);

create index if not exists idx_schedules_employee_day on schedules (employee_id, day);

create table if not exists earnings (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees (id) on delete cascade,
  amount numeric(12, 2) not null,
  date date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_earnings_employee_date on earnings (employee_id, date);

-- Reminder dedupe (24h / 2h)
create table if not exists booking_reminders (
  id bigint generated always as identity primary key,
  booking_id bigint not null references bookings (id) on delete cascade,
  kind text not null check (kind in ('24h', '2h')),
  sent_at timestamptz not null default now(),
  unique (booking_id, kind)
);

-- Phone login for CRM (returns one row as JSON or null)
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
  select to_json(e.*) into row
  from employees e
  where regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = norm
    and e.active = true
  limit 1;
  return row;
end;
$$;

grant execute on function public.verify_staff_phone(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: permissive policies for local/dev with anon key.
-- Replace with role-based policies before production.
-- ---------------------------------------------------------------------------
alter table categories enable row level security;
alter table schedules enable row level security;
alter table earnings enable row level security;
alter table booking_reminders enable row level security;

drop policy if exists "salon_categories_all" on categories;
create policy "salon_categories_all" on categories for all using (true) with check (true);

drop policy if exists "salon_schedules_all" on schedules;
create policy "salon_schedules_all" on schedules for all using (true) with check (true);

drop policy if exists "salon_earnings_all" on earnings;
create policy "salon_earnings_all" on earnings for all using (true) with check (true);

drop policy if exists "salon_reminders_all" on booking_reminders;
create policy "salon_reminders_all" on booking_reminders for all using (true) with check (true);

alter table employees enable row level security;
drop policy if exists "salon_employees_all" on employees;
create policy "salon_employees_all" on employees for all using (true) with check (true);

alter table services enable row level security;
drop policy if exists "salon_services_all" on services;
create policy "salon_services_all" on services for all using (true) with check (true);

alter table employee_services enable row level security;
drop policy if exists "salon_employee_services_all" on employee_services;
create policy "salon_employee_services_all" on employee_services for all using (true) with check (true);

alter table bookings enable row level security;
drop policy if exists "salon_bookings_all" on bookings;
create policy "salon_bookings_all" on bookings for all using (true) with check (true);

-- Realtime (run once in Supabase Dashboard → Database → Publications if this errors on re-run)
-- alter publication supabase_realtime add table bookings;
-- alter publication supabase_realtime add table schedules;
