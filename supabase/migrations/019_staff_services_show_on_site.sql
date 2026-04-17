-- Per staff–service link: hide master from public site / public booking while keeping CRM eligibility.

alter table public.staff_services
  add column if not exists show_on_site boolean not null default true;

comment on column public.staff_services.show_on_site is
  'When false, the master remains linked to the service for CRM but is hidden from marketing team block and public booking.';
