-- Multi-role staff: roles text[] replaces single role column.
-- Run after 001 + 002 (+ optional 003 seed that still used `role`).

alter table employees add column if not exists roles text[];

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'role'
  ) then
    update employees
    set roles = array[role]::text[]
    where roles is null;
  end if;
end $$;

update employees
set roles = array['employee']::text[]
where roles is null;

alter table employees alter column roles set default array['employee']::text[];
alter table employees alter column roles set not null;

alter table employees drop constraint if exists employees_roles_nonempty;
alter table employees add constraint employees_roles_nonempty check (cardinality(roles) >= 1);

alter table employees drop constraint if exists employees_roles_allowed;
alter table employees add constraint employees_roles_allowed
  check (roles <@ array['admin', 'manager', 'employee']::text[]);

alter table employees drop column if exists role;
