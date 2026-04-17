-- Per staff: show on marketing site + public booking (shadow-test admins by turning ON).

alter table public.staff add column if not exists show_on_marketing_site boolean not null default true;

comment on column public.staff.show_on_marketing_site is
  'When false, hidden from marketing team block and public booking. Default false for admin/owner; enable in CRM to shadow-test.';

update public.staff s
set show_on_marketing_site = false
where lower(coalesce(s.role, '')) in ('admin', 'owner')
   or exists (
     select 1
     from unnest(coalesce(s.roles, array[]::text[])) as u(role)
     where lower(u.role) in ('admin', 'owner')
   );
