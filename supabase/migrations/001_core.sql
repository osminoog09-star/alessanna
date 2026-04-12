-- Run in Supabase SQL editor (or supabase db push). Mirrors app entities for Postgres migration.

create extension if not exists "pgcrypto";

-- Staff profiles
create table if not exists employees (
  id bigint generated always as identity primary key,
  name text not null,
  phone text,
  email text,
  active boolean not null default true,
  slug text unique,
  google_refresh_token text,
  created_at timestamptz not null default now()
);

-- App login accounts
create table if not exists users (
  id bigint generated always as identity primary key,
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'manager', 'employee')),
  employee_id bigint references employees (id),
  created_at timestamptz not null default now()
);

create table if not exists services (
  id bigint generated always as identity primary key,
  slug text unique,
  name_et text not null,
  name_en text,
  category text default 'general',
  duration_min int not null default 60,
  buffer_after_min int not null default 10,
  price_cents int not null default 0,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists salon_hours (
  weekday int primary key,
  open_min int not null,
  close_min int not null
);

create table if not exists bookings (
  id bigint generated always as identity primary key,
  service_id bigint not null references services (id),
  employee_id bigint not null references employees (id),
  client_name text not null,
  client_phone text,
  client_email text,
  start_at text not null,
  end_at text not null,
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  source text not null default 'online' check (source in ('online', 'manual')),
  notes text,
  created_by bigint references users (id),
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bookings_employee_start on bookings (employee_id, start_at);
create index if not exists idx_bookings_status on bookings (status);

-- QR / device login sessions (UUID token string)
create table if not exists sessions (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),
  user_id bigint references users (id),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  expires_at bigint not null,
  created_at bigint not null
);

create index if not exists idx_sessions_token on sessions (token);
create index if not exists idx_sessions_expires on sessions (expires_at);

-- Which services each employee offers (empty = implement “all” or restrict in app)
create table if not exists employee_services (
  employee_id bigint not null references employees (id) on delete cascade,
  service_id bigint not null references services (id) on delete cascade,
  primary key (employee_id, service_id)
);
