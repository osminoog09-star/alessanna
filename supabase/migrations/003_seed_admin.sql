-- Optional: first CRM login (phone digits only in verify_staff_phone).
-- Run after 001 + 002. Adjust phone to match your admin.

insert into employees (name, phone, role, active, payroll_type, commission, fixed_salary)
select 'Admin', '55686845', 'admin', true, 'percent', 0, 0
where not exists (
  select 1 from employees e
  where regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = '55686845'
);
