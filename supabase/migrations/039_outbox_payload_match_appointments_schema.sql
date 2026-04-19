-- 039_outbox_payload_match_appointments_schema.sql
-- Чиним триггер enqueue_appointment_outbox: payload использовал NEW.source и
-- NEW.notes, которых в актуальной схеме `appointments` нет:
--   * `source` — была удалена ранее (миграции 030/031 schema-cleanup),
--   * `notes`  — переименована в `note` миграцией 030_appointments_note_and_persist.
--
-- Симптом: триггер на каждом INSERT падал с "record 'new' has no field 'source'",
-- но был обёрнут в `exception when others then raise warning … return new;` —
-- поэтому INSERT в appointments проходил, а строка в notifications_outbox
-- НЕ создавалась. Итог: события Google Calendar не отправлялись.
--
-- Это переделывает payload: вместо несуществующих колонок берём константу
-- 'manual' для source (значение не критично — потребитель использует поле
-- только для логов/фильтров) и читаем `note` вместо `notes`.

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
    'source',          'manual',
    'notes',           coalesce(new.note, '')
  );

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
