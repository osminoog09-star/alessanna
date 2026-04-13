-- ARCHITECTURE.md compliance check (read-only)
-- Run in Supabase SQL editor after migrations.

-- 1) REQUIRED TABLES
with required_tables(table_name) as (
  values
    ('staff'),
    ('clients'),
    ('appointments'),
    ('appointment_services'),
    ('service_listings'),
    ('service_categories'),
    ('staff_schedule'),
    ('staff_time_off'),
    ('staff_work_days')
)
select
  rt.table_name,
  case when t.table_name is null then 'MISSING' else 'OK' end as status
from required_tables rt
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = rt.table_name
order by rt.table_name;

-- 2) REQUIRED COLUMNS
with required_columns(table_name, column_name) as (
  values
    ('staff','id'),
    ('staff','name'),
    ('staff','phone'),
    ('staff','role'),
    ('staff','is_active'),
    ('staff','work_type'),
    ('staff','percent_rate'),
    ('staff','rent_per_day'),

    ('clients','id'),
    ('clients','name'),
    ('clients','phone'),
    ('clients','created_at'),

    ('appointments','id'),
    ('appointments','client_id'),
    ('appointments','created_at'),

    ('appointment_services','id'),
    ('appointment_services','appointment_id'),
    ('appointment_services','service_id'),
    ('appointment_services','staff_id'),
    ('appointment_services','start_time'),
    ('appointment_services','end_time'),

    ('service_listings','id'),
    ('service_listings','name'),
    ('service_listings','price'),
    ('service_listings','duration'),
    ('service_listings','category_id'),

    ('service_categories','id'),
    ('service_categories','name'),

    ('staff_schedule','staff_id'),
    ('staff_schedule','day_of_week'),
    ('staff_schedule','start_time'),
    ('staff_schedule','end_time'),

    ('staff_time_off','staff_id'),
    ('staff_time_off','start_time'),
    ('staff_time_off','end_time'),
    ('staff_time_off','time_off_type'),

    ('staff_work_days','staff_id'),
    ('staff_work_days','date'),
    ('staff_work_days','is_working')
)
select
  rc.table_name,
  rc.column_name,
  case when c.column_name is null then 'MISSING' else 'OK' end as status
from required_columns rc
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = rc.table_name
 and c.column_name = rc.column_name
order by rc.table_name, rc.column_name;

-- 3) REQUIRED FOREIGN KEYS
with required_fk(table_name, column_name, foreign_table_name, foreign_column_name) as (
  values
    ('appointments','client_id','clients','id'),
    ('appointment_services','appointment_id','appointments','id'),
    ('appointment_services','staff_id','staff','id')
)
select
  rf.table_name,
  rf.column_name,
  rf.foreign_table_name,
  rf.foreign_column_name,
  case
    when tc.constraint_name is null then 'MISSING'
    else 'OK'
  end as status
from required_fk rf
left join information_schema.key_column_usage kcu
  on kcu.table_schema = 'public'
 and kcu.table_name = rf.table_name
 and kcu.column_name = rf.column_name
left join information_schema.table_constraints tc
  on tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
 and tc.constraint_name = kcu.constraint_name
 and tc.constraint_type = 'FOREIGN KEY'
left join information_schema.referential_constraints rc
  on rc.constraint_schema = tc.table_schema
 and rc.constraint_name = tc.constraint_name
left join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema = rc.unique_constraint_schema
 and ccu.constraint_name = rc.unique_constraint_name
 and ccu.table_name = rf.foreign_table_name
 and ccu.column_name = rf.foreign_column_name
order by rf.table_name, rf.column_name;

-- 4) REQUIRED ENUM-LIKE CHECKS
select
  'staff.work_type in (percentage, rent)' as check_name,
  case when exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'staff'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%work_type%'
      and pg_get_constraintdef(c.oid) ilike '%percentage%'
      and pg_get_constraintdef(c.oid) ilike '%rent%'
  ) then 'OK' else 'MISSING' end as status
union all
select
  'staff_time_off.time_off_type in (sick_leave, day_off, manual_block)' as check_name,
  case when exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'staff_time_off'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%time_off_type%'
      and pg_get_constraintdef(c.oid) ilike '%sick_leave%'
      and pg_get_constraintdef(c.oid) ilike '%day_off%'
      and pg_get_constraintdef(c.oid) ilike '%manual_block%'
  ) then 'OK' else 'MISSING' end as status;

