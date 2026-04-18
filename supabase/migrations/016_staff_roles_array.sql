-- NOTE: Второй файл с префиксом «016_»; применяется после
-- 016_public_catalog_read_policies.sql (см. сортировку имён в папке).

-- Staff multi-role support for admin UI.
-- Additive: keeps legacy `role` column for compatibility.

alter table public.staff add column if not exists roles text[];

update public.staff
set roles = array[coalesce(role, 'worker')]
where roles is null or cardinality(roles) = 0;

alter table public.staff alter column roles set default array['worker']::text[];
alter table public.staff alter column roles set not null;

alter table public.staff drop constraint if exists staff_roles_nonempty;
alter table public.staff
  add constraint staff_roles_nonempty
  check (cardinality(roles) >= 1);

alter table public.staff drop constraint if exists staff_roles_allowed;
alter table public.staff
  add constraint staff_roles_allowed
  check (
    roles <@ array['owner','admin','manager','worker']::text[]
  );

