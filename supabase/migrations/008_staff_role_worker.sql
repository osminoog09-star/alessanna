-- Rename line-staff role from `staff` to `worker` (app + DB alignment).

alter table public.staff drop constraint if exists staff_role_check;

update public.staff set role = 'worker' where role = 'staff';

alter table public.staff alter column role set default 'worker';

alter table public.staff
  add constraint staff_role_check check (role in ('admin', 'manager', 'worker'));
