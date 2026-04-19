-- 047_salon_devices.sql
-- ============================================================================
-- «Устройства салона» поверх 041_staff_pin_and_trusted_devices.sql.
--
-- БЫЛО: каждое доверенное устройство жёстко привязано к staff_id того, кто
-- залогинился — заходить с него мог только этот сотрудник. Если планшет на
-- ресепшене зарегистрировал мастер Аня, то Галя при логине на этом же
-- планшете всё равно видит «введите PIN».
--
-- ХОЧЕТСЯ: пара устройств (планшет на ресепшене, ноут хозяина), которые
-- *любой активный сотрудник* может использовать без PIN — это «устройства
-- салона». Привилегию назначения даёт только админ.
--
-- ПОТОК:
--   1) сотрудник логинится → автоматически создаётся trusted_device на него
--      (см. изменение в LoginPage: trustThisDevice=true теперь по умолчанию);
--   2) админ заходит в /profile/security, видит список ВСЕХ устройств всех
--      сотрудников и кликает «Сделать устройством салона»;
--   3) флаг is_salon_device = true → токен теперь подходит при логине ЛЮБОГО
--      активного staff (см. правки в staff_login ниже);
--   4) админ может «Вернуть владельцу» (снять флаг) или «Отозвать» вообще.
--
-- Поле staff_id остаётся: это «кто первый зарегистрировал» (для аудита).
-- Поле claimed_by_admin_id хранит, кто из админов поднял устройство в статус
-- салонного — для чёткого следа в журнале.
-- ============================================================================

begin;

alter table public.staff_trusted_devices
  add column if not exists is_salon_device boolean not null default false,
  add column if not exists claimed_by_admin_id uuid references public.staff(id) on delete set null,
  add column if not exists claimed_at timestamptz;

comment on column public.staff_trusted_devices.is_salon_device is
  'true = устройство принадлежит салону, валидный токен пускает любого активного сотрудника без PIN. Назначает только админ.';
comment on column public.staff_trusted_devices.claimed_by_admin_id is
  'Кто из админов перевёл устройство в статус салонного. Для аудита.';

-- Удобный индекс для админского списка «Все устройства салона».
create index if not exists staff_trusted_devices_salon_idx
  on public.staff_trusted_devices (is_salon_device)
  where is_salon_device = true and revoked_at is null;

-- ============================================================================
-- staff_login: расширяем «trusted device» — принимаем салонные устройства,
-- даже если они зарегистрированы на другого сотрудника.
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
begin
  s := public._staff_resolve_by_phone(phone_input);
  if s.id is null then
    return jsonb_build_object('status', 'access_denied');
  end if;

  -- LEGACY MODE: PIN не установлен → пускаем по телефону, как раньше.
  if s.pin_hash is null then
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'legacy_no_pin',
      'staff', public._staff_to_public_json(s)
    );
  end if;

  -- TRUSTED DEVICE: токен валиден, если
  --   (а) это его собственное устройство (staff_id = s.id), либо
  --   (б) это салонное устройство (is_salon_device = true) — тогда годится
  --       для любого активного сотрудника. Это и есть «общий планшет».
  if device_token is not null and device_token <> '' then
    select td.* into device_row
    from public.staff_trusted_devices td
    where td.device_token_hash = public._staff_token_hash(device_token)
      and td.revoked_at is null
      and (td.staff_id = s.id or td.is_salon_device = true)
    limit 1;
    if device_row.id is not null then
      update public.staff_trusted_devices
        set last_seen_at = now()
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

  -- Проверка временной блокировки после серии неудач.
  if s.pin_locked_until is not null and s.pin_locked_until > now() then
    return jsonb_build_object(
      'status', 'pin_locked',
      'locked_until', s.pin_locked_until
    );
  end if;

  -- PIN MODE: токена нет (или невалидный) → требуем PIN.
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

  -- Если попросили запомнить устройство — генерим новый токен.
  if trust_this_device then
    new_token := encode(gen_random_bytes(24), 'base64');
    new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');
    new_token_hash := public._staff_token_hash(new_token);
    insert into public.staff_trusted_devices (
      staff_id, device_token_hash, label, user_agent, last_seen_at
    ) values (
      s.id,
      new_token_hash,
      coalesce(nullif(trim(device_label), ''), 'CRM device'),
      user_agent_input,
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
-- staff_list_trusted_devices: добавляем поля, нужные UI (is_salon_device).
-- Сигнатура совместима — фронт умеет читать новые ключи как опциональные.
-- ============================================================================

create or replace function public.staff_list_trusted_devices(
  staff_id_input uuid
)
returns setof jsonb
language sql
security definer
set search_path = public, extensions
as $$
  -- Сотрудник видит только СВОИ устройства (включая те, которые у него
  -- забрал салон). Список «всех» — отдельный admin-RPC ниже.
  select jsonb_build_object(
    'id', td.id,
    'label', td.label,
    'user_agent', td.user_agent,
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

-- ============================================================================
-- Admin-only RPCs для управления устройствами
-- ============================================================================

-- Хелпер: проверить, что переданный staff_id — действительно админ.
-- security definer обходит RLS, поэтому проверка роли — наша обязанность.
create or replace function public._staff_assert_admin(actor_id uuid)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s public.staff;
  has_admin boolean := false;
begin
  if actor_id is null then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into s from public.staff where id = actor_id and is_active = true;
  if s.id is null then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if lower(coalesce(s.role, '')) = 'admin' then
    has_admin := true;
  end if;
  if not has_admin then
    select true into has_admin
    from unnest(coalesce(s.roles, '{}'::text[])) r
    where lower(r) = 'admin'
    limit 1;
  end if;
  if not coalesce(has_admin, false) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end;
$$;

-- Список ВСЕХ устройств (для админской таблицы в /profile/security).
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

-- «Сделать устройством салона»
create or replace function public.staff_admin_claim_device_for_salon(
  device_id_input uuid,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  update public.staff_trusted_devices
    set is_salon_device = true,
        claimed_by_admin_id = actor_id,
        claimed_at = now()
    where id = device_id_input
      and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_admin_claim_device_for_salon(uuid, uuid) from public;
grant execute on function public.staff_admin_claim_device_for_salon(uuid, uuid)
  to anon, authenticated;

-- «Вернуть владельцу» — снимаем флаг is_salon_device, оставляя устройство
-- доверенным для исходного staff_id.
create or replace function public.staff_admin_release_device_to_owner(
  device_id_input uuid,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  update public.staff_trusted_devices
    set is_salon_device = false,
        claimed_by_admin_id = null,
        claimed_at = null
    where id = device_id_input
      and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_admin_release_device_to_owner(uuid, uuid) from public;
grant execute on function public.staff_admin_release_device_to_owner(uuid, uuid)
  to anon, authenticated;

-- Полный отзыв (логичная пара к двум предыдущим, чтобы админ мог банить
-- украденный/утерянный планшет одной кнопкой даже если он салонный).
create or replace function public.staff_admin_revoke_device(
  device_id_input uuid,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  update public.staff_trusted_devices
    set revoked_at = now()
    where id = device_id_input
      and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_already_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_admin_revoke_device(uuid, uuid) from public;
grant execute on function public.staff_admin_revoke_device(uuid, uuid)
  to anon, authenticated;

commit;
