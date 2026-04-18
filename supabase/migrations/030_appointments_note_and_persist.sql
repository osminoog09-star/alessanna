-- 030_appointments_note_and_persist.sql
--
-- Bugfix: public.public_book_chain принимал p_client_note и возвращал его в
-- ответе, но НЕ сохранял в БД. У public.appointments не было колонки note,
-- поэтому комментарий клиента (например "светлое окрашивание") терялся
-- между фронтом и CRM.
--
-- Фикс:
--   1) добавляем appointments.note text null;
--   2) пересоздаём public.public_book_chain c записью v_note в insert.
--
-- Идемпотентно: add column if not exists + create or replace function.

alter table public.appointments add column if not exists note text null;

create or replace function public.public_book_chain(
  p_client_name text,
  p_client_phone text,
  p_client_note text,
  p_start_at timestamptz,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_client_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_client_phone, '')), '');
  v_note text := nullif(btrim(coalesce(p_client_note, '')), '');
  v_item jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_service_id uuid;
  v_wanted_staff text;
  v_service record;
  v_staff_id uuid;
  v_staff_name text;
  v_cursor timestamptz;
  v_end timestamptz;
  v_dur int;
  v_buf int;
  v_appointment_id uuid;
  v_client_id uuid;
  v_idx int := 0;
  v_count int;
  v_cand uuid;
begin
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'missing_name', 'message', 'Name required.');
  end if;
  if p_start_at is null then
    return jsonb_build_object('ok', false, 'error', 'missing_start', 'message', 'Start time required.');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_items', 'message', 'Items must be array.');
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_items', 'message', 'Pick at least one service.');
  end if;
  if v_count > 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items', 'message', 'Too many services per visit.');
  end if;

  if v_phone is not null then
    select id into v_client_id from public.clients where phone = v_phone limit 1;
    if v_client_id is null then
      insert into public.clients (name, phone) values (v_name, v_phone) returning id into v_client_id;
    else
      update public.clients set name = v_name where id = v_client_id and name <> v_name;
    end if;
  else
    insert into public.clients (name, phone) values (v_name, null) returning id into v_client_id;
  end if;

  v_cursor := p_start_at;

  for v_idx in 0 .. (v_count - 1) loop
    v_item := p_items -> v_idx;
    if jsonb_typeof(v_item) is distinct from 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid_item', 'message', 'Invalid item.', 'hint', jsonb_build_object('index', v_idx));
    end if;
    begin
      v_service_id := nullif(v_item ->> 'service_id', '')::uuid;
    exception when others then
      v_service_id := null;
    end;
    if v_service_id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_service', 'message', 'Service missing.', 'hint', jsonb_build_object('index', v_idx));
    end if;

    select sl.id, sl.name, coalesce(sl.is_active, true) as is_active, sl.duration, coalesce(sl.buffer_after_min, 0) as buffer_after_min
      into v_service
      from public.service_listings sl
      where sl.id = v_service_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'service_not_found', 'message', 'Service not found.', 'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    if not v_service.is_active then
      return jsonb_build_object('ok', false, 'error', 'service_inactive', 'message', 'Service not bookable.', 'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    v_dur := coalesce(v_service.duration, 0);
    v_buf := coalesce(v_service.buffer_after_min, 0);
    if v_dur <= 0 then
      return jsonb_build_object('ok', false, 'error', 'service_no_duration', 'message', 'Service has no duration.', 'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    v_end := v_cursor + make_interval(mins => v_dur);

    v_wanted_staff := coalesce(v_item ->> 'staff_id', '');
    v_staff_id := null;
    if v_wanted_staff is null or v_wanted_staff = '' or v_wanted_staff = 'any' then
      for v_cand in
        select s.id from public.staff s
         where s.is_active = true
           and coalesce(s.show_on_marketing_site, true) <> false
           and public.public_staff_does_service(s.id, v_service_id)
         order by s.name
      loop
        if not public.public_staff_busy_during(v_cand, v_cursor, v_end) then
          v_staff_id := v_cand;
          exit;
        end if;
      end loop;
      if v_staff_id is null then
        return jsonb_build_object('ok', false, 'error', 'no_free_master', 'message', 'No free master for the slot.', 'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id, 'start_time', v_cursor, 'end_time', v_end));
      end if;
    else
      begin
        v_staff_id := v_wanted_staff::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_staff', 'message', 'Invalid master.', 'hint', jsonb_build_object('index', v_idx));
      end;
      if not exists (
        select 1 from public.staff s
        where s.id = v_staff_id and s.is_active = true and coalesce(s.show_on_marketing_site, true) <> false
      ) then
        return jsonb_build_object('ok', false, 'error', 'staff_unavailable', 'message', 'Master unavailable.', 'hint', jsonb_build_object('index', v_idx, 'staff_id', v_staff_id));
      end if;
      if not public.public_staff_does_service(v_staff_id, v_service_id) then
        return jsonb_build_object('ok', false, 'error', 'staff_not_service', 'message', 'Master does not perform the service.', 'hint', jsonb_build_object('index', v_idx, 'staff_id', v_staff_id, 'service_id', v_service_id));
      end if;
      if public.public_staff_busy_during(v_staff_id, v_cursor, v_end) then
        return jsonb_build_object('ok', false, 'error', 'staff_busy', 'message', 'Master busy in the slot.', 'hint', jsonb_build_object('index', v_idx, 'staff_id', v_staff_id, 'start_time', v_cursor, 'end_time', v_end));
      end if;
    end if;

    select s.name into v_staff_name from public.staff s where s.id = v_staff_id;

    v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
      'service_id', v_service_id,
      'service_name', v_service.name,
      'staff_id', v_staff_id,
      'staff_name', v_staff_name,
      'start_time', v_cursor,
      'end_time', v_end,
      'duration_min', v_dur,
      'buffer_after_min', v_buf
    ));

    v_cursor := v_end + make_interval(mins => v_buf);
  end loop;

  insert into public.appointments (
    staff_id, service_id, client_id, client_name, client_phone, start_time, end_time, note
  ) values (
    (v_items_out->0->>'staff_id')::uuid,
    (v_items_out->0->>'service_id')::uuid,
    v_client_id,
    v_name,
    v_phone,
    (v_items_out->0->>'start_time')::timestamptz,
    (v_items_out->(jsonb_array_length(v_items_out) - 1)->>'end_time')::timestamptz,
    v_note
  ) returning id into v_appointment_id;

  insert into public.appointment_services (
    appointment_id, service_id, staff_id, start_time, end_time
  ) select
    v_appointment_id,
    (x->>'service_id')::uuid,
    (x->>'staff_id')::uuid,
    (x->>'start_time')::timestamptz,
    (x->>'end_time')::timestamptz
  from jsonb_array_elements(v_items_out) x;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment_id,
    'client_id', v_client_id,
    'note', v_note,
    'items', v_items_out
  );
end;
$fn$;

revoke all on function public.public_book_chain(text, text, text, timestamptz, jsonb) from public;
grant execute on function public.public_book_chain(text, text, text, timestamptz, jsonb) to anon, authenticated, service_role;
