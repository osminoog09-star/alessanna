-- 041_staff_pin_and_trusted_devices.sql
-- ============================================================================
-- P0: усиление CRM-аутентификации.
--
-- БЫЛО: единственный фактор — телефон. Знаешь номер мастера → ты вошёл.
--   Никаких секретов, ни истории устройств, ни возможности отозвать сессию.
--
-- СТАЛО:
--   1. На staff появляется опциональный PIN (bcrypt-хеш через pgcrypto).
--   2. Появляется таблица staff_trusted_devices: «доверенные» устройства,
--      с которых можно входить только по телефону (без PIN). Токен
--      хранится у клиента в localStorage; в БД — только sha256-хеш.
--   3. Новый RPC staff_login(phone, pin?, device_token?) — единая точка
--      входа: пускает либо по доверенному устройству, либо по PIN.
--   4. Backward compatibility: если у staff PIN не задан (pin_hash IS NULL),
--      работает старая модель «вход по телефону» — пока админ не установит PIN.
--   5. Старый verify_staff_phone остаётся (для совместимости со старым фронтом
--      на время катящегося релиза), но помечен deprecated.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PIN на staff
-- ============================================================================

alter table public.staff
  add column if not exists pin_hash text,
  add column if not exists pin_set_at timestamptz,
  add column if not exists pin_failed_attempts int not null default 0,
  add column if not exists pin_locked_until timestamptz;

comment on column public.staff.pin_hash is
  'bcrypt-хеш PIN (через pgcrypto crypt). NULL = PIN не установлен, работает legacy-вход по телефону.';
comment on column public.staff.pin_locked_until is
  'Если задан и > now(), вход PIN временно заблокирован после 5 неудач. Сбрасывается при успешном входе.';

-- ============================================================================
-- 2. Доверенные устройства
-- ============================================================================

create table if not exists public.staff_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  -- sha256 от plaintext device_token (16 байт случайных, base64url).
  -- Plaintext НИКОГДА не хранится в БД — только у клиента в localStorage.
  device_token_hash text not null,
  label text not null default '',
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint staff_trusted_devices_token_unique unique (device_token_hash)
);

create index if not exists staff_trusted_devices_staff_id_idx
  on public.staff_trusted_devices (staff_id) where revoked_at is null;

create index if not exists staff_trusted_devices_revoked_at_idx
  on public.staff_trusted_devices (revoked_at);

comment on table public.staff_trusted_devices is
  'Доверенные устройства мастера: при наличии валидного device_token логин идёт без PIN.';

-- ============================================================================
-- 3. RLS — таблица только через RPC
-- ============================================================================

alter table public.staff_trusted_devices enable row level security;

drop policy if exists staff_trusted_devices_no_direct on public.staff_trusted_devices;
create policy staff_trusted_devices_no_direct
  on public.staff_trusted_devices
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- 4. Хелперы
-- ============================================================================

create or replace function public._staff_normalize_phone(phone_input text)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  digits text;
begin
  if phone_input is null then return ''; end if;
  digits := regexp_replace(phone_input, '\D', '', 'g');
  return digits;
end;
$$;

-- staff_id ищем строго так же, как 029_verify_staff_phone_normalize_country:
-- сначала точное совпадение, потом по последним 7 цифрам.
create or replace function public._staff_resolve_by_phone(phone_input text)
returns public.staff
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  digits text;
  exact_row public.staff;
  suffix_row public.staff;
begin
  digits := public._staff_normalize_phone(phone_input);
  if length(digits) < 4 then
    return null;
  end if;

  select s.* into exact_row
  from public.staff s
  where s.is_active = true
    and regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = digits
  limit 1;
  if exact_row.id is not null then
    return exact_row;
  end if;

  if length(digits) >= 7 then
    select s.* into suffix_row
    from public.staff s
    where s.is_active = true
      and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 7) = right(digits, 7)
    order by s.created_at asc
    limit 1;
    if suffix_row.id is not null then
      return suffix_row;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public._staff_token_hash(token_input text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(coalesce(token_input, ''), 'sha256'), 'hex');
$$;

create or replace function public._staff_to_public_json(s public.staff)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  -- ВАЖНО: НЕ возвращаем google_calendar_* и прочие технические поля.
  -- Раньше verify_staff_phone отдавал to_json(s.*) и всё это попадало в localStorage.
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'phone', s.phone,
    'role', s.role,
    'roles', s.roles,
    'is_active', s.is_active
  );
$$;

-- ============================================================================
-- 5. Главный RPC: staff_login
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
  -- На UI админ должен видеть «у вас нет PIN, безопаснее установить».
  if s.pin_hash is null then
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'legacy_no_pin',
      'staff', public._staff_to_public_json(s)
    );
  end if;

  -- TRUSTED DEVICE: если токен валиден — пускаем без PIN.
  if device_token is not null and device_token <> '' then
    select td.* into device_row
    from public.staff_trusted_devices td
    where td.staff_id = s.id
      and td.device_token_hash = public._staff_token_hash(device_token)
      and td.revoked_at is null
    limit 1;
    if device_row.id is not null then
      update public.staff_trusted_devices
        set last_seen_at = now()
        where id = device_row.id;
      -- Сбрасываем счётчик неудач, т.к. устройство доверено.
      update public.staff
        set pin_failed_attempts = 0,
            pin_locked_until = null
        where id = s.id;
      return jsonb_build_object(
        'status', 'ok',
        'mode', 'trusted_device',
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

  -- PIN корректный — сбрасываем счётчик.
  update public.staff
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where id = s.id;

  -- Если попросили запомнить устройство — генерим новый токен.
  if trust_this_device then
    -- 24 байта случайных → 32 base64-символа без =. Достаточно для CRM.
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
-- 6. Управление PIN
-- ============================================================================

create or replace function public.staff_set_pin(
  staff_id_input uuid,
  current_pin text,
  new_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.staff;
begin
  if new_pin is null or length(new_pin) < 4 or length(new_pin) > 12 then
    return jsonb_build_object('status', 'invalid_pin_format');
  end if;
  if new_pin !~ '^[0-9]+$' then
    return jsonb_build_object('status', 'invalid_pin_format');
  end if;

  select * into s from public.staff where id = staff_id_input;
  if s.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Если PIN уже был установлен, требуем текущий.
  if s.pin_hash is not null then
    if current_pin is null or current_pin = '' then
      return jsonb_build_object('status', 'current_pin_required');
    end if;
    if s.pin_hash <> crypt(current_pin, s.pin_hash) then
      return jsonb_build_object('status', 'invalid_current_pin');
    end if;
  end if;

  update public.staff
    set pin_hash = crypt(new_pin, gen_salt('bf', 10)),
        pin_set_at = now(),
        pin_failed_attempts = 0,
        pin_locked_until = null
    where id = staff_id_input;

  -- Когда меняем PIN, ВСЕ доверенные устройства отзываются — это стандарт
  -- (как в Google: смена пароля разлогинивает все сессии).
  update public.staff_trusted_devices
    set revoked_at = now()
    where staff_id = staff_id_input
      and revoked_at is null;

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_set_pin(uuid, text, text) from public;
grant execute on function public.staff_set_pin(uuid, text, text)
  to anon, authenticated;

-- ============================================================================
-- 7. Управление доверенными устройствами
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
    'created_at', td.created_at,
    'last_seen_at', td.last_seen_at,
    'revoked_at', td.revoked_at
  )
  from public.staff_trusted_devices td
  where td.staff_id = staff_id_input
  order by td.revoked_at nulls first, td.last_seen_at desc;
$$;

revoke all on function public.staff_list_trusted_devices(uuid) from public;
grant execute on function public.staff_list_trusted_devices(uuid)
  to anon, authenticated;

create or replace function public.staff_revoke_trusted_device(
  staff_id_input uuid,
  device_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.staff_trusted_devices
    set revoked_at = now()
    where id = device_id_input
      and staff_id = staff_id_input
      and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_already_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_revoke_trusted_device(uuid, uuid) from public;
grant execute on function public.staff_revoke_trusted_device(uuid, uuid)
  to anon, authenticated;

-- Удобный счётчик для UI (точка над «вы вошли с N устройств»).
create or replace function public.staff_active_devices_count(
  staff_id_input uuid
)
returns int
language sql
security definer
set search_path = public, extensions
as $$
  select count(*)::int
  from public.staff_trusted_devices
  where staff_id = staff_id_input
    and revoked_at is null;
$$;

revoke all on function public.staff_active_devices_count(uuid) from public;
grant execute on function public.staff_active_devices_count(uuid)
  to anon, authenticated;

-- ============================================================================
-- 8. Deprecate старого verify_staff_phone (но оставляем работающим)
-- ============================================================================

comment on function public.verify_staff_phone(text) is
  'DEPRECATED 2026-04-19: использовать public.staff_login(phone, pin?, device_token?). '
  'Временно оставлен для обратной совместимости с фронтом до выкатки v2.';
