-- GREENFIELD ONLY: run on an empty project (no existing public.services).
-- This matches the product spec verbatim. This repo’s migration chain already
-- creates bigint public.services in 001_core.sql — use 011_service_categories_catalog.sql instead.

create extension if not exists "pgcrypto";

create table if not exists service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric,
  duration int,
  category_id uuid references service_categories (id) on delete set null,
  is_active boolean default true,
  created_at timestamptz default now()
);
