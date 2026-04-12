-- Add `owner` to staff.role (same app privileges as admin; distinct label only).

alter table public.staff drop constraint if exists staff_role_check;

alter table public.staff
  add constraint staff_role_check check (role in ('owner', 'admin', 'manager', 'worker'));
