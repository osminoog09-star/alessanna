-- 037_outbox_skip_staff_when_no_oauth.sql
-- Уточнение поведения триггера enqueue_appointment_outbox.
--
-- Раньше для каждой записи создавались ДВЕ строки в notifications_outbox:
--   1) salon  — общий календарь салона;
--   2) staff:<uuid> — личный календарь мастера (даже если OAuth не подключён,
--                    тогда строка ставилась в 'skipped').
--
-- В реальной эксплуатации это создаёт мусорные skipped-строки на каждую
-- запись, а у нас появился второй (более простой) сценарий доставки события
-- мастеру: «Email-приглашение». В этом сценарии Edge Function берёт
-- единственную salon-строку, создаёт событие в общем календаре салона и
-- добавляет email мастера (staff.calendar_email) в attendees — событие
-- появляется в календаре мастера автоматически (Gmail/Workspace) или
-- приходит как .ics-приглашение (Outlook/Apple/Yandex).
--
-- Поэтому теперь staff-строку создаём ТОЛЬКО если у мастера действительно
-- подключён собственный OAuth (google_calendar_status = 'connected').
-- Иначе никакой staff-строки нет — всё делается через salon-строку.
--
-- Существующие skipped staff-строки можно безопасно оставить — они никогда
-- не активируются (мастер либо подключит OAuth и тогда новые записи пойдут
-- по новой логике, либо использует email-режим и старые skipped-строки
-- больше не нужны).

create or replace function public.enqueue_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon_status text;
  v_staff_status text;
  v_payload      jsonb;
begin
  v_payload := jsonb_build_object(
    'appointment_id',  new.id,
    'staff_id',        new.staff_id,
    'service_id',      new.service_id,
    'client_name',     new.client_name,
    'client_phone',    new.client_phone,
    'start_time',      new.start_time,
    'end_time',        new.end_time,
    'status',          new.status,
    'source',          new.source,
    'notes',           coalesce(new.notes, '')
  );

  -- ---- салон --------------------------------------------------------
  select coalesce(value, 'disconnected')
    into v_salon_status
    from public.salon_settings
    where key = 'google_calendar_status'
    limit 1;

  insert into public.notifications_outbox (
    appointment_id, kind, target_scope, payload, status
  )
  values (
    new.id,
    'google_calendar_event',
    'salon',
    v_payload,
    case when v_salon_status = 'connected' then 'pending' else 'skipped' end
  );

  -- ---- личный календарь мастера ------------------------------------
  -- Только если у мастера реально подключён OAuth. Иначе доставка идёт
  -- через salon-строку + attendees (см. комментарий в шапке файла).
  if new.staff_id is not null then
    select coalesce(google_calendar_status, 'disconnected')
      into v_staff_status
      from public.staff
      where id = new.staff_id;

    if v_staff_status = 'connected' then
      insert into public.notifications_outbox (
        appointment_id, kind, target_scope, payload, status
      )
      values (
        new.id,
        'google_calendar_event',
        'staff:' || new.staff_id::text,
        v_payload,
        'pending'
      );
    end if;
  end if;

  return new;
exception when others then
  raise warning 'enqueue_appointment_outbox failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_appointment_outbox() from public;
