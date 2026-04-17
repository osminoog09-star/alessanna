-- Older Supabase projects may lack is_active on service_listings; PostgREST then errors on select(..., is_active).
alter table public.service_listings
  add column if not exists is_active boolean not null default true;

comment on column public.service_listings.is_active is 'When false, listing is hidden from public catalog (CRM toggle).';
