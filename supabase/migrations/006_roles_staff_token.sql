-- Use `staff` instead of `employee`; map legacy `viewer` → `staff`.

update employees
set roles = array(
  select case
    when lower(x) in ('viewer', 'employee') then 'staff'
    else x
  end
  from unnest(roles) as x
)
where exists (
  select 1 from unnest(roles) as x where lower(x) in ('viewer', 'employee')
);

alter table employees alter column roles set default array['staff']::text[];

alter table employees drop constraint if exists employees_roles_allowed;
alter table employees add constraint employees_roles_allowed
  check (roles <@ array['admin', 'manager', 'staff']::text[]);
