-- 048_trusted_device_ip.sql
-- ============================================================================
-- Доверенные устройства: фиксируем IP клиента.
--
-- БЫЛО: колонка staff_trusted_devices.ip_address есть с 041, но никто её не
-- заполнял. В UI «Доверенные устройства» был только User-Agent — невозможно
-- быстро отличить «вход с ноута дома» от «вход из салона».
--
-- СТАЛО:
--   1) staff_login на каждом успешном входе:
--        – при создании нового trusted_device пишет IP клиента;
--        – при «вход по доверенному устройству» обновляет ip_address и
--          last_seen_at (чтобы видно было, откуда сейчас заходят).
--   2) Списки (staff_list_trusted_devices, staff_admin_list_all_devices)
--      возвращают ip_address. UI показывает IP рядом с временем входа.
--
-- IP берём из request.headers (PostgREST прокидывает заголовки HTTP-запроса
-- в GUC). Поддерживаем несколько форматов: x-forwarded-for, x-real-ip,
-- cf-connecting-ip (Cloudflare). x-forwarded-for может быть списком — берём
-- первый адрес (исходный клиент). Если ничего нет — fallback на
-- inet_client_addr() (адрес соединения, обычно прокси Supabase).
-- ============================================================================

begin;

create or replace function public._staff_request_client_ip()
returns inet
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  hdr_raw text;
  hdr jsonb;
  candidate text;
begin
  begin
    hdr_raw := current_setting('request.headers', true);
  exception when others then
    hdr_raw := null;
  end;

  if hdr_raw is not null and hdr_raw <> '' then
    begin
      hdr := hdr_raw::jsonb;
    exception when others then
      hdr := null;
    end;
  end if;

  if hdr is not null then
    -- x-forwarded-for: «client, proxy1, proxy2» — берём первый
    candidate := hdr ->> 'x-forwarded-for';
    if candidate is not null and candidate <> '' then
      candidate := trim(split_part(candidate, ',', 1));
      begin
        return candidate::inet;
      exception when others then
        null;
      end;
    end if;

    candidate := hdr ->> 'x-real-ip';
    if candidate is not null and candidate <> '' then
      begin
        return trim(candidate)::inet;
      exception when others then
        null;
      end;
    end if;

    candidate := hdr ->> 'cf-connecting-ip';
    if candidate is not null and candidate <> '' then
      begin
        return trim(candidate)::inet;
      exception when others then
        null;
      end;
    end if;
  end if;

  return inet_client_addr();
end;
$$;

grant execute on function public._staff_request_client_ip() to anon, authenticated;

-- ============================================================================
-- staff_login: пишем IP при создании устройства И при последующих входах
-- ============================================================================

create or replace function public.staff_login(
  phone_input text,
  pin_input text default null,
  device_token text default null,
  trust_this_device boolean default false,
  device_label text default null,
  user_agent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.staff;
  device_row public.staff_trusted_devices;
  new_token text;
  new_token_hash text;
  client_ip inet;
begin
  client_ip := public._staff_request_client_ip();

  s := public._staff_resolve_by_phone(phone_input);
  if s.id is null then
    return jsonb_build_object('status', 'access_denied');
  end if;

  if s.pin_hash is null then
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'legacy_no_pin',
      'staff', public._staff_to_public_json(s)
    );
  end if;

  if device_token is not null and device_token <> '' then
    select td.* into device_row
    from public.staff_trusted_devices td
    where td.device_token_hash = public._staff_token_hash(device_token)
      and td.revoked_at is null
      and (td.staff_id = s.id or td.is_salon_device = true)
    limit 1;
    if device_row.id is not null then
      update public.staff_trusted_devices
        set last_seen_at = now(),
            ip_address = coalesce(client_ip, ip_address)
        where id = device_row.id;
      update public.staff
        set pin_failed_attempts = 0,
            pin_locked_until = null
        where id = s.id;
      return jsonb_build_object(
        'status', 'ok',
        'mode', case when device_row.is_salon_device
                     then 'salon_device'
                     else 'trusted_device' end,
        'staff', public._staff_to_public_json(s)
      );
    end if;
  end if;

  if s.pin_locked_until is not null and s.pin_locked_until > now() then
    return jsonb_build_object(
      'status', 'pin_locked',
      'locked_until', s.pin_locked_until
    );
  end if;

  if pin_input is null or pin_input = '' then
    return jsonb_build_object(
      'status', 'requires_pin',
      'staff_name', s.name
    );
  end if;

  if s.pin_hash <> crypt(pin_input, s.pin_hash) then
    update public.staff
      set pin_failed_attempts = pin_failed_attempts + 1,
          pin_locked_until = case
            when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
            else null
          end
      where id = s.id;
    return jsonb_build_object('status', 'invalid_pin');
  end if;

  update public.staff
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where id = s.id;

  if trust_this_device then
    new_token := encode(gen_random_bytes(24), 'base64');
    new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');
    new_token_hash := public._staff_token_hash(new_token);
    insert into public.staff_trusted_devices (
      staff_id, device_token_hash, label, user_agent, ip_address, last_seen_at
    ) values (
      s.id,
      new_token_hash,
      coalesce(nullif(trim(device_label), ''), 'CRM device'),
      user_agent_input,
      client_ip,
      now()
    );
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'pin_with_new_device',
      'staff', public._staff_to_public_json(s),
      'new_device_token', new_token
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'mode', 'pin_only',
    'staff', public._staff_to_public_json(s)
  );
end;
$$;

revoke all on function public.staff_login(text, text, text, boolean, text, text) from public;
grant execute on function public.staff_login(text, text, text, boolean, text, text)
  to anon, authenticated;

-- ============================================================================
-- Списки: возвращаем ip_address (UI покажет рядом с временем)
-- ============================================================================

create or replace function public.staff_list_trusted_devices(
  staff_id_input uuid
)
returns setof jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', td.id,
    'label', td.label,
    'user_agent', td.user_agent,
    'ip_address', host(td.ip_address),
    'created_at', td.created_at,
    'last_seen_at', td.last_seen_at,
    'revoked_at', td.revoked_at,
    'is_salon_device', td.is_salon_device,
    'claimed_at', td.claimed_at
  )
  from public.staff_trusted_devices td
  where td.staff_id = staff_id_input
  order by td.revoked_at nulls first, td.last_seen_at desc;
$$;

revoke all on function public.staff_list_trusted_devices(uuid) from public;
grant execute on function public.staff_list_trusted_devices(uuid)
  to anon, authenticated;

create or replace function public.staff_admin_list_all_devices(
  actor_id uuid
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  return query
    select jsonb_build_object(
      'id', td.id,
      'label', td.label,
      'user_agent', td.user_agent,
      'ip_address', host(td.ip_address),
      'created_at', td.created_at,
      'last_seen_at', td.last_seen_at,
      'revoked_at', td.revoked_at,
      'is_salon_device', td.is_salon_device,
      'claimed_at', td.claimed_at,
      'staff_id', td.staff_id,
      'staff_name', s.name,
      'claimed_by_admin_id', td.claimed_by_admin_id,
      'claimed_by_admin_name', a.name
    )
    from public.staff_trusted_devices td
    left join public.staff s on s.id = td.staff_id
    left join public.staff a on a.id = td.claimed_by_admin_id
    order by td.is_salon_device desc, td.revoked_at nulls first, td.last_seen_at desc;
end;
$$;

revoke all on function public.staff_admin_list_all_devices(uuid) from public;
grant execute on function public.staff_admin_list_all_devices(uuid)
  to anon, authenticated;

commit;
