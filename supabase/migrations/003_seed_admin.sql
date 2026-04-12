-- Optional: first CRM login (phone digits only in verify_staff_phone).
-- Run after 001 + 002. Replace the placeholder phone with your real admin digits before applying.

insert into employees (name, phone, role, active, payroll_type, commission, fixed_salary)
select 'Admin', '00000000', 'admin', true, 'percent', 0, 0
where not exists (
  select 1 from employees e
  where regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = '00000000'
);
