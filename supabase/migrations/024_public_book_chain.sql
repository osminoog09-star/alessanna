-- 024_public_book_chain.sql
-- Публичная RPC для мульти-сервис записи с цепочкой времён.
--
-- Публичный сайт отправляет n услуг и для каждой — выбранного мастера
-- (или "any" = пусть салон решит). Функция:
--   * валидирует услуги (существует + активна + есть duration),
--   * раскладывает цепочку (start + duration + buffer_after_min),
--   * для "any" подбирает первого свободного мастера, закреплённого за услугой,
--   * проверяет занятость мастеров (appointment_services/appointments/time_off),
--   * атомарно создаёт `appointments` + N строк `appointment_services`,
--   * возвращает JSONB c id записи и раскладкой по времени.
--
-- RLS на appointments/appointment_services сейчас disabled, но функция
-- всё равно помечена SECURITY DEFINER и closed search_path — чтобы
-- анонимный пользователь мог её вызвать через anon key без прав на таблицы.
--
-- Идемпотентность: все объекты объявлены через create or replace /
-- drop if exists, чтобы миграцию можно было накатывать повторно.

-- ------------------------------------------------------------------
-- Хелпер: проверяет, делает ли мастер услугу.
-- Семантика зеркалит клиентский `hasLink()`:
--   * если у мастера нет ни одной строки в staff_services → считаем, что
--     он делает все активные услуги (implicit mode);
--   * иначе нужна строка с этим service_id (с учётом show_on_site != false).
-- ------------------------------------------------------------------
create or replace function public.public_staff_does_service(
  p_staff_id uuid,
  p_service_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with links as (
    select show_on_site, service_id
    from public.staff_services
    where staff_id = p_staff_id
  ),
  totals as (
    select count(*) as cnt from links
  )
  select case
    when (select cnt from totals) = 0 then true
    else exists (
      select 1 from links
      where service_id = p_service_id
        and coalesce(show_on_site, true) <> false
    )
  end;
$$;

revoke all on function public.public_staff_does_service(uuid, uuid) from public;
grant execute on function public.public_staff_does_service(uuid, uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- Хелпер: есть ли у мастера пересечение с интервалом [start, end).
-- Учитывает: appointment_services, legacy appointments.staff_id, staff_time_off.
-- ------------------------------------------------------------------
create or replace function public.public_staff_busy_during(
  p_staff_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointment_services a
    where a.staff_id = p_staff_id
      and a.start_time < p_end
      and a.end_time > p_start
  )
  or exists (
    -- Legacy/single-service записи: могли быть созданы до chain-миграции.
    select 1 from public.appointments a
    where a.staff_id = p_staff_id
      and a.start_time is not null
      and a.end_time is not null
      and a.start_time < p_end
      and a.end_time > p_start
      -- Исключаем записи, у которых есть appointment_services (чтобы не
      -- дублировать тот же интервал из двух источников).
      and not exists (
        select 1 from public.appointment_services s where s.appointment_id = a.id
      )
  )
  or exists (
    select 1 from public.staff_time_off t
    where t.staff_id = p_staff_id
      and t.start_time < p_end
      and t.end_time > p_start
  );
$$;

revoke all on function public.public_staff_busy_during(uuid, timestamptz, timestamptz) from public;
grant execute on function public.public_staff_busy_during(uuid, timestamptz, timestamptz) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- Главный RPC: создаёт цепочку appointment_services атомарно.
-- Вход:
--   p_client_name  text  — имя посетителя (обязательно).
--   p_client_phone text  — телефон, может быть null/пустой.
--   p_client_note  text  — произвольный комментарий (сохраняется в первом AS).
--   p_start_at     timestamptz — старт первой услуги (с TZ). Округлять до минут
--                                 должен клиент; функция не округляет.
--   p_items        jsonb — массив { service_id:uuid, staff_id:uuid|null|"any" }
--                           в порядке оказания услуг.
--
-- Возврат: jsonb
--   {
--     ok: true,
--     appointment_id: uuid,
--     client_id: uuid,
--     items: [{ service_id, service_name, staff_id, staff_name,
--               start_time, end_time, duration_min, buffer_after_min }]
--   }
-- Или { ok: false, error: 'code', message: 'human text', hint: jsonb }.
-- ------------------------------------------------------------------
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
as $$
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
    return jsonb_build_object('ok', false, 'error', 'missing_name',
      'message', 'Имя посетителя обязательно.');
  end if;
  if p_start_at is null then
    return jsonb_build_object('ok', false, 'error', 'missing_start',
      'message', 'Не указано стартовое время.');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_items',
      'message', 'Ожидается массив услуг.');
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_items',
      'message', 'Выберите хотя бы одну услугу.');
  end if;
  if v_count > 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items',
      'message', 'Слишком много услуг за один визит.');
  end if;

  -- Клиент: upsert по phone (если есть) или просто создаём.
  if v_phone is not null then
    select id into v_client_id from public.clients
      where phone = v_phone limit 1;
    if v_client_id is null then
      insert into public.clients (name, phone) values (v_name, v_phone)
        returning id into v_client_id;
    else
      update public.clients set name = v_name where id = v_client_id and name <> v_name;
    end if;
  else
    insert into public.clients (name, phone) values (v_name, null)
      returning id into v_client_id;
  end if;

  v_cursor := p_start_at;

  -- Валидируем и раскладываем.
  for v_idx in 0 .. (v_count - 1) loop
    v_item := p_items -> v_idx;

    if jsonb_typeof(v_item) is distinct from 'object' then
      return jsonb_build_object('ok', false, 'error', 'invalid_item',
        'message', 'Некорректный элемент в списке услуг.',
        'hint', jsonb_build_object('index', v_idx));
    end if;

    begin
      v_service_id := nullif(v_item ->> 'service_id', '')::uuid;
    exception when others then
      v_service_id := null;
    end;
    if v_service_id is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_service',
        'message', 'Не указана услуга.',
        'hint', jsonb_build_object('index', v_idx));
    end if;

    select sl.id, sl.name, coalesce(sl.is_active, true) as is_active,
           sl.duration, coalesce(sl.buffer_after_min, 0) as buffer_after_min
      into v_service
      from public.service_listings sl
      where sl.id = v_service_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'service_not_found',
        'message', 'Услуга не найдена.',
        'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    if not v_service.is_active then
      return jsonb_build_object('ok', false, 'error', 'service_inactive',
        'message', 'Услуга сейчас недоступна.',
        'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    v_dur := coalesce(v_service.duration, 0);
    v_buf := coalesce(v_service.buffer_after_min, 0);
    if v_dur <= 0 then
      return jsonb_build_object('ok', false, 'error', 'service_no_duration',
        'message', 'Для услуги не указана длительность.',
        'hint', jsonb_build_object('index', v_idx, 'service_id', v_service_id));
    end if;
    v_end := v_cursor + make_interval(mins => v_dur);

    -- Резолвим мастера.
    v_wanted_staff := coalesce(v_item ->> 'staff_id', '');
    v_staff_id := null;
    if v_wanted_staff is null or v_wanted_staff = '' or v_wanted_staff = 'any' then
      -- Любой свободный мастер, который делает услугу и не заблокирован.
      for v_cand in
        select s.id
          from public.staff s
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
        return jsonb_build_object('ok', false, 'error', 'no_free_master',
          'message', 'Нет свободного мастера для услуги в выбранное время.',
          'hint', jsonb_build_object(
            'index', v_idx,
            'service_id', v_service_id,
            'start_time', v_cursor,
            'end_time', v_end
          ));
      end if;
    else
      begin
        v_staff_id := v_wanted_staff::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'invalid_staff',
          'message', 'Некорректный мастер.',
          'hint', jsonb_build_object('index', v_idx));
      end;

      if not exists (
        select 1 from public.staff s
        where s.id = v_staff_id
          and s.is_active = true
          and coalesce(s.show_on_marketing_site, true) <> false
      ) then
        return jsonb_build_object('ok', false, 'error', 'staff_unavailable',
          'message', 'Выбранный мастер недоступен.',
          'hint', jsonb_build_object('index', v_idx, 'staff_id', v_staff_id));
      end if;

      if not public.public_staff_does_service(v_staff_id, v_service_id) then
        return jsonb_build_object('ok', false, 'error', 'staff_not_service',
          'message', 'Этот мастер не делает выбранную услугу.',
          'hint', jsonb_build_object('index', v_idx,
            'staff_id', v_staff_id, 'service_id', v_service_id));
      end if;

      if public.public_staff_busy_during(v_staff_id, v_cursor, v_end) then
        return jsonb_build_object('ok', false, 'error', 'staff_busy',
          'message', 'Мастер занят в выбранное время.',
          'hint', jsonb_build_object('index', v_idx,
            'staff_id', v_staff_id, 'start_time', v_cursor, 'end_time', v_end));
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

  -- Создаём родительский appointment. staff_id/service_id берём из первой позиции
  -- (чтобы legacy-список «Записей» продолжал что-то показывать, пока админка
  -- не умеет рисовать цепочки).
  insert into public.appointments (
    staff_id, service_id, client_id, client_name, client_phone,
    start_time, end_time
  )
  values (
    (v_items_out->0->>'staff_id')::uuid,
    (v_items_out->0->>'service_id')::uuid,
    v_client_id,
    v_name,
    v_phone,
    (v_items_out->0->>'start_time')::timestamptz,
    (v_items_out->(jsonb_array_length(v_items_out) - 1)->>'end_time')::timestamptz
  )
  returning id into v_appointment_id;

  -- Разворачиваем массив в строки.
  insert into public.appointment_services (
    appointment_id, service_id, staff_id, start_time, end_time
  )
  select
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
$$;

revoke all on function public.public_book_chain(text, text, text, timestamptz, jsonb) from public;
grant execute on function public.public_book_chain(text, text, text, timestamptz, jsonb) to anon, authenticated, service_role;

comment on function public.public_book_chain(text, text, text, timestamptz, jsonb) is
  'Public booking endpoint for multi-service chain: resolves/validates masters, computes sequential times, atomically creates appointments + appointment_services. Returns JSON.';
