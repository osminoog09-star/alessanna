-- Enforce the invariant: staff with admin/owner role are never visible on the
-- public marketing site. Previously this was handled only on the client, so any
-- direct DB edit could slip an admin back into /meistrid. A BEFORE INSERT/UPDATE
-- trigger keeps show_on_marketing_site = false for such rows unconditionally.
--
-- Idempotent: re-applying drops and recreates the trigger cleanly.

alter table public.staff
  add column if not exists show_on_marketing_site boolean not null default true;

update public.staff s
set show_on_marketing_site = false
where lower(coalesce(s.role, '')) in ('admin', 'owner')
   or exists (
     select 1
     from unnest(coalesce(s.roles, array[]::text[])) as u(role)
     where lower(u.role) in ('admin', 'owner')
   );

create or replace function public.staff_hide_admin_from_site()
returns trigger
language plpgsql
as $$
declare
  is_admin boolean;
begin
  is_admin := lower(coalesce(new.role, '')) in ('admin', 'owner')
    or exists (
      select 1
      from unnest(coalesce(new.roles, array[]::text[])) as u(role)
      where lower(u.role) in ('admin', 'owner')
    );

  if is_admin then
    new.show_on_marketing_site := false;
  end if;

  return new;
end
$$;

drop trigger if exists trg_staff_hide_admin_from_site on public.staff;
create trigger trg_staff_hide_admin_from_site
  before insert or update on public.staff
  for each row
  execute function public.staff_hide_admin_from_site();

comment on function public.staff_hide_admin_from_site is
  'Keeps show_on_marketing_site = false for admin/owner staff regardless of how the row was written (CRM, SQL, etc.).';
