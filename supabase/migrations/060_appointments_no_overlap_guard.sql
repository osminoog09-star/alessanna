-- 060_appointments_no_overlap_guard.sql
-- Жёсткий серверный guard: один мастер не может иметь пересекающиеся записи.
-- Защищает от гонок, когда два клиента/оператора нажимают "записать" одновременно.

create or replace function public.assert_no_appointment_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.staff_id is null or new.start_time is null or new.end_time is null then
    return new;
  end if;

  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.staff_id = new.staff_id
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(a.status, '') <> 'cancelled'
      and a.start_time < new.end_time
      and a.end_time > new.start_time
  ) then
    raise exception 'overlap'
      using
        errcode = '23P01',
        message = 'Этот мастер уже занят в выбранное время.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_no_overlap on public.appointments;
create trigger trg_appointments_no_overlap
before insert or update of staff_id, start_time, end_time, status
on public.appointments
for each row
execute function public.assert_no_appointment_overlap();
