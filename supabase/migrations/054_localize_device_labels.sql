-- 054_localize_device_labels.sql
-- ============================================================================
-- Локализация технических дефолтных лейблов trusted-устройств.
--
-- ЗАЧЕМ. В UI «Безопасность профиля» вверху карточки устройства показывается
-- его label. Раньше (миграции 041/047/049/052) дефолтные лейблы были
-- латиницей: `'CRM device'`, `'Invite link'`, `'Invited device'`. Это
-- технические маркеры — их видит конечный пользователь, и в русском интерфейсе
-- это бьётся в глаза («Invite link»).
--
-- Кроме того в `staff_invite_approve_submission` (049) лейбл по дефолту
-- становился именем заявителя (`submitted_name`). Это плохо: имя уже
-- отображено отдельно «Привязано к: …», а в шапке устройства лучше иметь
-- описание самого девайса. Переключаем на единый русский маркер.
--
-- РЕШЕНИЕ:
--   1. Backfill уже сохранённых строк (на свежей БД ничего не сломает —
--      просто обновит 0 строк).
--   2. Переписываем `staff_login` (последняя версия из 052), `staff_consume_invite`
--      (legacy из удалённой 049_staff_invite_links.sql, всё ещё живёт в проде)
--      и `staff_invite_approve_submission` (049): меняем дефолт `'CRM device'`
--      на `'Браузер CRM'`, `'Invite link'`/`'Invited device'` на
--      `'Ссылка-приглашение'`. В approve — больше НЕ подставляем
--      `submitted_name`.
--
-- ЗАЩИТА В UI: фронт (`localizeDeviceLabel` в `ProfileSecurityPage.tsx`)
-- параллельно маппит старые латинские значения, на случай если какой-то
-- путь в БД ещё пишет английский дефолт. Это double-safety: фронт
-- защищает от прошлого и от потенциальных регрессий, миграция гарантирует,
-- что даже свежая БД (бэкап+restore) сразу даст русские лейблы.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1) Backfill существующих лейблов.
-- ----------------------------------------------------------------------------

update public.staff_trusted_devices
   set label = 'Ссылка-приглашение'
 where label in ('Invite link', 'Invited device');

update public.staff_trusted_devices
   set label = 'Браузер CRM'
 where label = 'CRM device';

-- ----------------------------------------------------------------------------
-- 2) staff_login — копия из 052, отличается только дефолтом lейбла.
--    Сигнатуру не меняем (anon уже имеет grant).
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
      coalesce(nullif(trim(device_label), ''), 'Браузер CRM'),
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
-- 3) staff_consume_invite (legacy invite-link RPC).
--    Перепиcываем только чтобы убрать английский 'Invite link'.
--    PublicInvitePage уже на новом потоке (staff_invite_submit/approve),
--    но функция всё ещё может вызываться по сторонним legacy ссылкам.
-- ----------------------------------------------------------------------------

create or replace function public.staff_consume_invite(
  token_input text,
  device_label text default null,
  user_agent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  inv_id uuid;
  inv_staff_id uuid;
  inv_max_uses int;
  inv_uses int;
  inv_expires timestamptz;
  inv_revoked timestamptz;
  s public.staff;
  new_device_token text;
  new_device_hash text;
  client_ip inet;
begin
  if token_input is null or length(token_input) < 8 then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  client_ip := public._staff_request_client_ip();

  select i.id, i.staff_id, i.max_uses, i.uses_count, i.expires_at, i.revoked_at
    into inv_id, inv_staff_id, inv_max_uses, inv_uses, inv_expires, inv_revoked
    from public.staff_invite_links i
    where i.token_hash = public._staff_token_hash(token_input)
    for update;

  if inv_id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;
  if inv_revoked is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  if inv_expires <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if inv_uses >= inv_max_uses then
    return jsonb_build_object('status', 'used_up');
  end if;

  select * into s from public.staff where id = inv_staff_id;
  if s.id is null or s.is_active is not true then
    return jsonb_build_object('status', 'staff_inactive');
  end if;

  update public.staff_invite_links
    set uses_count = uses_count + 1,
        last_used_at = now(),
        last_used_ip = client_ip
    where id = inv_id;

  new_device_token := encode(gen_random_bytes(24), 'base64');
  new_device_token := replace(replace(replace(new_device_token, '+', '-'), '/', '_'), '=', '');
  new_device_hash := public._staff_token_hash(new_device_token);

  insert into public.staff_trusted_devices (
    staff_id, device_token_hash, label, user_agent, ip_address, last_seen_at
  ) values (
    inv_staff_id,
    new_device_hash,
    coalesce(nullif(trim(device_label), ''), 'Ссылка-приглашение'),
    user_agent_input,
    client_ip,
    now()
  );

  return jsonb_build_object(
    'status', 'ok',
    'mode', 'invite',
    'staff', public._staff_to_public_json(s),
    'new_device_token', new_device_token
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) staff_invite_approve_submission — больше НЕ берём submitted_name как
--    лейбл девайса (оно дублирует «Привязано к: …»). Лейбл —
--    единый маркер «Ссылка-приглашение». Остальная логика без изменений.
-- ----------------------------------------------------------------------------

create or replace function public.staff_invite_approve_submission(
  submission_id_input uuid,
  actor_id uuid,
  action_input text,
  target_staff_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sub public.staff_invite_submissions;
  inv public.staff_invites;
  target_staff public.staff;
  new_staff_id uuid;
  resolved_role text;
  resolved_roles text[];
  device_label text;
  is_salon boolean;
begin
  perform public._staff_assert_admin(actor_id);

  if action_input is null or action_input not in ('create_new', 'attach') then
    return jsonb_build_object('status', 'invalid_action');
  end if;

  select * into sub from public.staff_invite_submissions where id = submission_id_input for update;
  if sub.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if sub.status <> 'pending' then
    return jsonb_build_object('status', 'already_decided');
  end if;
  select * into inv from public.staff_invites where id = sub.invite_id;

  is_salon := (sub.device_kind = 'salon');
  -- ВАЖНО: device_label больше НЕ submitted_name. Имя пользователя и так
  -- отображается отдельно как «Привязано к: …». В шапке устройства нужен
  -- единый маркер происхождения, чтобы админ глазами видел: «эта строка
  -- пришла через ссылку-приглашение, а не через PIN-логин».
  device_label := 'Ссылка-приглашение';

  if action_input = 'attach' then
    if target_staff_id_input is null then
      return jsonb_build_object('status', 'target_required');
    end if;
    select * into target_staff from public.staff where id = target_staff_id_input;
    if target_staff.id is null then
      return jsonb_build_object('status', 'target_not_found');
    end if;
    new_staff_id := target_staff.id;
    update public.staff_invite_submissions
      set status = 'approved_attached',
          linked_staff_id = new_staff_id,
          decided_by_admin_id = actor_id,
          decided_at = now()
      where id = sub.id;
  else
    resolved_role := coalesce(nullif(trim(coalesce(inv.intended_role, '')), ''), 'worker');
    if resolved_role not in ('admin', 'manager', 'worker', 'master') then
      resolved_role := 'worker';
    end if;
    if resolved_role = 'master' then
      resolved_role := 'worker';
    end if;
    resolved_roles := array[resolved_role]::text[];

    insert into public.staff (name, phone, role, roles, is_active)
    values (
      sub.submitted_name,
      sub.submitted_phone,
      resolved_role,
      resolved_roles,
      true
    )
    returning id into new_staff_id;

    update public.staff_invite_submissions
      set status = 'approved_new',
          linked_staff_id = new_staff_id,
          decided_by_admin_id = actor_id,
          decided_at = now()
      where id = sub.id;
  end if;

  insert into public.staff_trusted_devices (
    staff_id, device_token_hash, label, user_agent, ip_address,
    is_salon_device, claimed_by_admin_id, claimed_at, last_seen_at
  ) values (
    new_staff_id,
    sub.device_token_hash,
    device_label,
    sub.user_agent,
    sub.ip_address,
    is_salon,
    case when is_salon then actor_id else null end,
    case when is_salon then now() else null end,
    now()
  )
  on conflict (device_token_hash) do nothing;

  return jsonb_build_object(
    'status', 'ok',
    'staff_id', new_staff_id,
    'is_salon_device', is_salon
  );
end;
$$;

commit;
