-- 067_google_sync_no_skipped_status.sql
-- Stop creating `skipped` outbox rows. Use `error` + explicit reason instead,
-- so CRM shows actionable sync failures and retry queue can process them.

create or replace function public.enqueue_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon_status text;
  v_staff_status text;
  v_scope text;
  v_payload jsonb;
  v_op text;
begin
  if tg_op = 'INSERT' then
    v_op := case when new.status = 'cancelled' then 'delete' else 'upsert' end;
    v_payload := jsonb_build_object(
      'operation', v_op,
      'appointment_id', new.id,
      'staff_id', new.staff_id,
      'service_id', new.service_id,
      'client_name', new.client_name,
      'client_phone', new.client_phone,
      'start_time', new.start_time,
      'end_time', new.end_time,
      'status', new.status,
      'source', coalesce(new.source, 'crm'),
      'note', coalesce(new.note, ''),
      'google_event_id', new.google_event_id
    );
  elsif tg_op = 'UPDATE' then
    if (new.staff_id, new.service_id, new.client_name, new.client_phone, new.start_time, new.end_time, new.status, new.note)
      is not distinct from
       (old.staff_id, old.service_id, old.client_name, old.client_phone, old.start_time, old.end_time, old.status, old.note)
    then
      return new;
    end if;
    v_op := case when new.status = 'cancelled' then 'delete' else 'upsert' end;
    v_payload := jsonb_build_object(
      'operation', v_op,
      'appointment_id', new.id,
      'staff_id', new.staff_id,
      'service_id', new.service_id,
      'client_name', new.client_name,
      'client_phone', new.client_phone,
      'start_time', new.start_time,
      'end_time', new.end_time,
      'status', new.status,
      'source', coalesce(new.source, 'crm'),
      'note', coalesce(new.note, ''),
      'google_event_id', new.google_event_id
    );
  else
    return coalesce(new, old);
  end if;

  select coalesce(value, 'disconnected')
    into v_salon_status
    from public.salon_settings
    where key = 'google_calendar_status'
    limit 1;

  insert into public.notifications_outbox (
    appointment_id, kind, target_scope, payload, status, last_error
  )
  values (
    coalesce(new.id, old.id),
    'google_calendar_event',
    'salon',
    v_payload,
    case when v_salon_status = 'connected' then 'pending' else 'error' end,
    case when v_salon_status = 'connected' then null else 'Google auth is disconnected for salon scope.' end
  );

  v_scope := 'staff:' || coalesce(new.staff_id, old.staff_id)::text;
  if coalesce(new.staff_id, old.staff_id) is not null then
    select coalesce(google_calendar_status, 'disconnected')
      into v_staff_status
      from public.staff
      where id = coalesce(new.staff_id, old.staff_id);

    insert into public.notifications_outbox (
      appointment_id, kind, target_scope, payload, status, last_error
    )
    values (
      coalesce(new.id, old.id),
      'google_calendar_event',
      v_scope,
      v_payload,
      case when v_staff_status = 'connected' then 'pending' else 'error' end,
      case when v_staff_status = 'connected' then null else 'Google auth is disconnected for staff scope.' end
    );
  end if;

  return new;
exception when others then
  raise warning 'enqueue_appointment_outbox failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.enqueue_appointment_outbox() from public;

update public.notifications_outbox
   set status = 'error',
       last_error = coalesce(last_error, 'Legacy skipped row: sync scope was disconnected.')
 where kind = 'google_calendar_event'
   and status = 'skipped';

