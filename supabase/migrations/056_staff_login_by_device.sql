-- 056_staff_login_by_device.sql
-- ============================================================================
-- Автологин по доверенному устройству (без ввода телефона).
--
-- КОНТЕКСТ.
--   Сейчас даже если у пользователя в localStorage сохранён device_token от
--   персонального доверенного устройства, при заходе в CRM его всё равно
--   просят ввести телефон. staff_login требует phone_input обязательным
--   параметром, поэтому UI показывает форму. Это лишний шаг и путаница:
--   «я же вошёл, почему опять спрашивают?».
--
--   Для персональных доверенных устройств (staff_trusted_devices.staff_id
--   не null, is_salon_device=false) сервер по токену однозначно знает, чья
--   это сессия — телефон нужен только салонным планшетам, где устройство
--   сознательно обезличено.
--
-- ЧТО ДЕЛАЕТ ЭТА ФУНКЦИЯ.
--   1. По device_token ищет активное (revoked_at is null) устройство.
--      Если не нашли — 'invalid_token' (фронт затирает токен и показывает
--      обычную форму с телефоном).
--   2. Если устройство салонное (is_salon_device=true) — возвращает
--      'requires_phone'. Автологин по салонному планшету бессмысленен,
--      потому что к нему не привязан конкретный сотрудник. Фронт в этом
--      случае просто показывает обычную форму, причём подпись «Это
--      устройство добавлено в доверенные — войдёте без PIN» остаётся.
--   3. Если устройство персональное — резолвит staff по staff_id. Если
--      сотрудник удалён/деактивирован — 'access_denied'. Иначе:
--      – обновляем last_seen_at;
--      – сбрасываем счётчик неудачных PIN и lock (раз вход успешен);
--      – пишем событие staff.login.ok в activity_log с mode=trusted_device_auto;
--      – возвращаем status='ok' + staff.
--
-- БЕЗОПАСНОСТЬ.
--   • Никакой новой поверхности атаки: проверки те же, что в staff_login
--     в ветке trusted_device (см. 052_salon_device_hardening.sql для
--     is_active защиты). Ничего обходить не требуется — всё через тот же
--     _staff_token_hash.
--   • Сигнатура старого staff_login не меняется; UI-fallback «телефон +
--     PIN» продолжает работать даже если эта функция недоступна.
-- ============================================================================

begin;

create or replace function public.staff_login_by_device(
  device_token text,
  user_agent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device_row public.staff_trusted_devices;
  s public.staff;
begin
  if device_token is null or length(trim(device_token)) = 0 then
    return jsonb_build_object('status','invalid_token');
  end if;

  select td.* into device_row
  from public.staff_trusted_devices td
  where td.device_token_hash = public._staff_token_hash(device_token)
    and td.revoked_at is null
  limit 1;

  if device_row.id is null then
    /* Не пишем в activity_log — у нас нет ни actor_id, ни cookie_id.
     * Событие покрывает фронт: затирает локальный токен и рендерит обычную
     * форму входа с телефоном. */
    return jsonb_build_object('status','invalid_token');
  end if;

  /* Салонное устройство обезличено — по одному токену сотрудника не
   * определить. UI увидит requires_phone и покажет форму с телефоном,
   * но уже без PIN (см. ветку «salon device» в staff_login). */
  if device_row.is_salon_device = true then
    return jsonb_build_object(
      'status','requires_phone',
      'reason','salon_device',
      'device_label', device_row.label
    );
  end if;

  if device_row.staff_id is null then
    return jsonb_build_object('status','invalid_token');
  end if;

  select st.* into s
  from public.staff st
  where st.id = device_row.staff_id
  limit 1;

  if s.id is null or coalesce(s.is_active, false) = false then
    /* Сотрудник удалён/деактивирован — токен фактически инвалидирован.
     * Отзовём устройство, чтобы больше не пытались им воспользоваться. */
    update public.staff_trusted_devices
      set revoked_at = now()
      where id = device_row.id and revoked_at is null;
    perform public._log_activity('staff', device_row.staff_id, null,
      'staff.login.access_denied', 'staff_login_by_device',
      device_row.id::text,
      jsonb_build_object('reason','inactive_or_missing_staff'));
    return jsonb_build_object('status','access_denied');
  end if;

  update public.staff_trusted_devices
    set last_seen_at = now(),
        /* user_agent обновляем только если пришёл — чтобы не затирать более
         * длинный UA коротким «сохранённой» записью. */
        user_agent = coalesce(nullif(trim(user_agent_input), ''), user_agent)
    where id = device_row.id;

  update public.staff
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where id = s.id;

  perform public._log_activity('staff', s.id, null, 'staff.login.ok',
    'staff_login_by_device', s.id::text,
    jsonb_build_object(
      'mode', 'trusted_device_auto',
      'device_id', device_row.id::text,
      'device_label', device_row.label
    ));

  return jsonb_build_object(
    'status','ok',
    'mode','trusted_device_auto',
    'staff', public._staff_to_public_json(s)
  );
end;
$$;

revoke all on function public.staff_login_by_device(text, text)
  from public, anon, authenticated;
grant execute on function public.staff_login_by_device(text, text)
  to anon, authenticated;

comment on function public.staff_login_by_device(text, text) is
  'Автологин по доверенному устройству без ввода телефона. Для персональных устройств возвращает ok+staff, для салонных — requires_phone, иначе invalid_token/access_denied.';

commit;
