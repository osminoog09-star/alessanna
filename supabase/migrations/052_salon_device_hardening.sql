-- 052_salon_device_hardening.sql
-- ============================================================================
-- Hotfix двух дыр в логике «устройств салона» (047_salon_devices.sql).
--
-- BUG 1 — staff_login + salon device + неактивный сотрудник.
--   Сейчас в ветке «trusted device» условие выглядит так:
--     and (td.staff_id = s.id or td.is_salon_device = true)
--   То есть, если устройство помечено как салонное, оно пускает ЛЮБОГО
--   сотрудника, найденного по телефону. На сегодня это формально не
--   эксплуатируется — _staff_resolve_by_phone уже фильтрует is_active = true,
--   так что неактивный staff просто не резолвится. Но защита сидит в одном
--   месте, и любой будущий рефакторинг резолвера откроет дыру:
--   уволенный сотрудник → его номер всё ещё в БД → салонный токен → доступ.
--   Это противоречит и комменту в файле («для любого активного сотрудника»,
--   строки 11 и 86), и соседнему RPC staff_consume_invite, где is_active
--   проверяется явно. Закрываем defense-in-depth: добавляем явную проверку
--   s.is_active = true в условие matchа салонного устройства.
--
-- BUG 2 — staff_admin_claim_device_for_salon перетирает аудит.
--   Сейчас функция всегда делает
--     set is_salon_device = true,
--         claimed_by_admin_id = actor_id,
--         claimed_at = now()
--   даже если устройство уже салонное. То есть если админ A назначил
--   планшет салонным месяц назад, а сегодня админ B случайно нажал ту же
--   кнопку — мы потеряли «кто и когда впервые поднял флаг». Это плохо для
--   расследований («кто разрешил этот планшет?»). Делаем claim идемпотентным:
--   повторный вызов на уже салонном устройстве НЕ трогает claimed_*, а
--   возвращает status='already_salon' с оригинальными значениями. Фронт
--   уже трактует не-'ok' статусы как информационные и просто перечитывает
--   список (см. ProfileSecurityPage.adminClaim — он вызывает reload в любом
--   случае).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- BUG 1 fix: явная проверка s.is_active = true в ветке salon device.
-- Сигнатура и поведение остальных веток (PIN, legacy, своё устройство) —
-- без изменений; переписываем функцию целиком, потому что Postgres не умеет
-- патчить тело функции точечно.
-- ----------------------------------------------------------------------------

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

  if s.pin_hash is null then
    return jsonb_build_object(
      'status', 'ok',
      'mode', 'legacy_no_pin',
      'staff', public._staff_to_public_json(s)
    );
  end if;

  -- TRUSTED DEVICE: токен валиден, если
  --   (а) это его собственное устройство (staff_id = s.id), либо
  --   (б) это салонное устройство (is_salon_device = true) И сам сотрудник
  --       активен. Без проверки s.is_active салонный планшет превратился бы
  --       в backdoor для уволенных мастеров: их номер остаётся в staff,
  --       а салонный токен пускает любого по телефону.
  if device_token is not null and device_token <> '' then
    select td.* into device_row
    from public.staff_trusted_devices td
    where td.device_token_hash = public._staff_token_hash(device_token)
      and td.revoked_at is null
      and (
        td.staff_id = s.id
        or (td.is_salon_device = true and s.is_active = true)
      )
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

revoke all on function public.staff_login(text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.staff_login(text, text, text, boolean, text, text)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- BUG 2 fix: идемпотентный claim, сохраняющий аудит.
--
-- Сначала пробуем обновить ТОЛЬКО строки, где is_salon_device = false —
-- это естественный фильтр «новый claim». Если ни одна строка не обновлена,
-- разбираемся почему: устройство revoked / не существует — отдаём прежний
-- 'not_found_or_revoked'; устройство уже салонное — отдаём новый
-- 'already_salon' с исходными claimed_by_admin_id / claimed_at. Так:
--   • первый клик админа A → status='ok', флаг ставится, аудит фиксируется;
--   • повторный клик админа B → status='already_salon', аудит НЕ затирается;
--   • UI всё равно перечитывает список (см. adminClaim в ProfileSecurityPage),
--     поэтому никаких изменений на фронте не требуется.
-- ----------------------------------------------------------------------------

create or replace function public.staff_admin_claim_device_for_salon(
  device_id_input uuid,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  current_row public.staff_trusted_devices;
begin
  perform public._staff_assert_admin(actor_id);

  update public.staff_trusted_devices
    set is_salon_device = true,
        claimed_by_admin_id = actor_id,
        claimed_at = now()
    where id = device_id_input
      and revoked_at is null
      and is_salon_device = false;

  if found then
    return jsonb_build_object('status', 'ok');
  end if;

  -- Ничего не обновили — выясняем причину, чтобы вернуть осмысленный статус
  -- и не терять аудит уже-салонного устройства.
  select * into current_row
    from public.staff_trusted_devices
    where id = device_id_input;

  if current_row.id is null or current_row.revoked_at is not null then
    return jsonb_build_object('status', 'not_found_or_revoked');
  end if;

  return jsonb_build_object(
    'status', 'already_salon',
    'claimed_by_admin_id', current_row.claimed_by_admin_id,
    'claimed_at', current_row.claimed_at
  );
end;
$$;

revoke all on function public.staff_admin_claim_device_for_salon(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.staff_admin_claim_device_for_salon(uuid, uuid)
  to anon, authenticated;

commit;
