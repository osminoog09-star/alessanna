-- 049_staff_invites.sql
-- ============================================================================
-- Приглашения мастеров/админов через ссылку.
--
-- ИДЕЯ: админ создаёт временную ссылку (с токеном). Кандидат открывает
-- /invite/<token>, заполняет короткую форму (имя, телефон, «моё устройство»
-- vs «устройство салона») и нажимает «Отправить». На бэке создаётся заявка
-- staff_invite_submission + временный device_token, который ВЕРНЁТСЯ клиенту,
-- но станет валидным только после approve админом.
--
-- Админ видит заявки в /admin/invites: для каждой — варианты «Создать
-- нового сотрудника» либо «Привязать к существующему» (с подсказкой по
-- похожему имени/телефону). После approve мы создаём строку в
-- staff_trusted_devices с правильным staff_id и опциональным
-- is_salon_device — устройство сразу пускает без PIN.
--
-- Безопасность:
--   * staff_invites.token хранится только хешем; в URL — plaintext.
--   * Лимиты: max_uses (по умолчанию 1) и expires_at (по умолчанию 7 дней).
--   * Каждый submit считается одним использованием.
--   * approve/reject — только админ (через _staff_assert_admin).
--   * lookup и submit — публичные RPC (anon), потому что у кандидата ещё
--     нет аккаунта в CRM.
-- ============================================================================

begin;

-- ============================================================================
-- 1. Таблица приглашений
-- ============================================================================

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  -- sha256 от plaintext-токена (32 байта). Plaintext НИГДЕ не хранится.
  token_hash text not null unique,
  created_by_admin_id uuid references public.staff(id) on delete set null,
  -- Подсказки админа кандидату/себе (необязательны).
  intended_role text,
  intended_name text,
  note text,
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses > 0),
  uses_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_invites_active_idx
  on public.staff_invites (expires_at)
  where revoked_at is null;

comment on table public.staff_invites is
  'Одноразовые/N-разовые ссылки-приглашения для регистрации сотрудника. Plaintext-токен только в URL.';
comment on column public.staff_invites.intended_role is
  'Подсказка админа: какая роль ожидается у приглашённого (master/manager/admin). Не обязывает.';

alter table public.staff_invites enable row level security;
drop policy if exists staff_invites_no_direct on public.staff_invites;
create policy staff_invites_no_direct
  on public.staff_invites
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- 2. Таблица заявок (submissions)
-- ============================================================================

create table if not exists public.staff_invite_submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.staff_invites(id) on delete cascade,
  submitted_name text not null,
  submitted_phone text not null,
  device_kind text not null check (device_kind in ('personal','salon')),
  device_token_hash text not null unique,
  user_agent text,
  ip_address inet,
  status text not null default 'pending'
    check (status in ('pending', 'approved_new', 'approved_attached', 'rejected')),
  linked_staff_id uuid references public.staff(id) on delete set null,
  decided_by_admin_id uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index if not exists staff_invite_submissions_status_idx
  on public.staff_invite_submissions (status, created_at desc);
create index if not exists staff_invite_submissions_invite_idx
  on public.staff_invite_submissions (invite_id);

comment on table public.staff_invite_submissions is
  'Заявка кандидата по invite-ссылке. Пока status=pending — device_token у клиента невалиден для логина.';

alter table public.staff_invite_submissions enable row level security;
drop policy if exists staff_invite_submissions_no_direct on public.staff_invite_submissions;
create policy staff_invite_submissions_no_direct
  on public.staff_invite_submissions
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- 3. Хелпер: безопасный нормализатор телефона (повторно используем)
-- ============================================================================

-- Уже есть public._staff_normalize_phone из 041, используем его.

-- ============================================================================
-- 4. Admin: создание приглашения
-- ============================================================================

create or replace function public.staff_invite_create(
  actor_id uuid,
  intended_role_input text default null,
  intended_name_input text default null,
  note_input text default null,
  expires_in_hours int default 168,  -- 7 дней
  max_uses_input int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  raw_token text;
  token_h text;
  invite_row public.staff_invites;
  hours_clamped int;
  uses_clamped int;
begin
  perform public._staff_assert_admin(actor_id);

  hours_clamped := greatest(1, least(24 * 30, coalesce(expires_in_hours, 168)));
  uses_clamped := greatest(1, least(50, coalesce(max_uses_input, 1)));

  -- 24 байта random → ~32 base64-символа без =. Plaintext возвращаем клиенту,
  -- в БД храним только sha256.
  raw_token := encode(gen_random_bytes(24), 'base64');
  raw_token := replace(replace(replace(raw_token, '+', '-'), '/', '_'), '=', '');
  token_h := public._staff_token_hash(raw_token);

  insert into public.staff_invites (
    token_hash, created_by_admin_id,
    intended_role, intended_name, note,
    expires_at, max_uses
  ) values (
    token_h, actor_id,
    nullif(trim(intended_role_input), ''),
    nullif(trim(intended_name_input), ''),
    nullif(trim(note_input), ''),
    now() + make_interval(hours => hours_clamped),
    uses_clamped
  )
  returning * into invite_row;

  return jsonb_build_object(
    'status', 'ok',
    'invite_id', invite_row.id,
    'token', raw_token,
    'expires_at', invite_row.expires_at,
    'max_uses', invite_row.max_uses
  );
end;
$$;

revoke all on function public.staff_invite_create(uuid, text, text, text, int, int) from public;
grant execute on function public.staff_invite_create(uuid, text, text, text, int, int)
  to anon, authenticated;

-- ============================================================================
-- 5. Admin: список приглашений
-- ============================================================================

create or replace function public.staff_invite_list(
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
      'id', i.id,
      'created_at', i.created_at,
      'created_by_admin_id', i.created_by_admin_id,
      'created_by_admin_name', a.name,
      'intended_role', i.intended_role,
      'intended_name', i.intended_name,
      'note', i.note,
      'expires_at', i.expires_at,
      'max_uses', i.max_uses,
      'uses_count', i.uses_count,
      'revoked_at', i.revoked_at,
      'is_active', (i.revoked_at is null
                     and i.expires_at > now()
                     and i.uses_count < i.max_uses),
      'pending_submissions',
        (select count(*)::int
         from public.staff_invite_submissions sub
         where sub.invite_id = i.id and sub.status = 'pending')
    )
    from public.staff_invites i
    left join public.staff a on a.id = i.created_by_admin_id
    order by i.created_at desc;
end;
$$;

revoke all on function public.staff_invite_list(uuid) from public;
grant execute on function public.staff_invite_list(uuid) to anon, authenticated;

create or replace function public.staff_invite_revoke(
  invite_id_input uuid,
  actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  update public.staff_invites
    set revoked_at = now()
    where id = invite_id_input and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_already_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_invite_revoke(uuid, uuid) from public;
grant execute on function public.staff_invite_revoke(uuid, uuid) to anon, authenticated;

-- ============================================================================
-- 6. Public: lookup invite by token (валидна ли ссылка?)
-- ============================================================================

create or replace function public.staff_invite_lookup(
  token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  i public.staff_invites;
begin
  if token_input is null or token_input = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into i
  from public.staff_invites
  where token_hash = public._staff_token_hash(token_input)
  limit 1;
  if i.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if i.revoked_at is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  if i.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if i.uses_count >= i.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'invite_id', i.id,
    'intended_role', i.intended_role,
    'intended_name', i.intended_name,
    'note', i.note,
    'expires_at', i.expires_at
  );
end;
$$;

revoke all on function public.staff_invite_lookup(text) from public;
grant execute on function public.staff_invite_lookup(text) to anon, authenticated;

-- ============================================================================
-- 7. Public: submit заявку
-- ============================================================================

create or replace function public.staff_invite_submit(
  token_input text,
  name_input text,
  phone_input text,
  device_kind_input text,
  user_agent_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  i public.staff_invites;
  raw_device_token text;
  device_h text;
  sub_row public.staff_invite_submissions;
  client_ip inet;
begin
  if token_input is null or trim(name_input) = '' or trim(phone_input) = '' then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  if device_kind_input is null or device_kind_input not in ('personal', 'salon') then
    return jsonb_build_object('status', 'invalid_device_kind');
  end if;

  client_ip := public._staff_request_client_ip();

  select * into i
  from public.staff_invites
  where token_hash = public._staff_token_hash(token_input)
  for update;
  if i.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if i.revoked_at is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  if i.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if i.uses_count >= i.max_uses then
    return jsonb_build_object('status', 'exhausted');
  end if;

  raw_device_token := encode(gen_random_bytes(24), 'base64');
  raw_device_token := replace(replace(replace(raw_device_token, '+', '-'), '/', '_'), '=', '');
  device_h := public._staff_token_hash(raw_device_token);

  insert into public.staff_invite_submissions (
    invite_id, submitted_name, submitted_phone, device_kind,
    device_token_hash, user_agent, ip_address
  ) values (
    i.id,
    trim(name_input),
    trim(phone_input),
    device_kind_input,
    device_h,
    user_agent_input,
    client_ip
  )
  returning * into sub_row;

  update public.staff_invites
    set uses_count = uses_count + 1
    where id = i.id;

  return jsonb_build_object(
    'status', 'ok',
    'submission_id', sub_row.id,
    'device_token', raw_device_token
  );
end;
$$;

revoke all on function public.staff_invite_submit(text, text, text, text, text) from public;
grant execute on function public.staff_invite_submit(text, text, text, text, text)
  to anon, authenticated;

-- ============================================================================
-- 8. Public: poll submission status (что ответил админ?)
-- Клиент шлёт submission_id + plaintext device_token (как доказательство, что
-- это его заявка — не чужая). Возвращаем status и, если approved, staff-объект
-- для авторизации в фронте.
-- ============================================================================

create or replace function public.staff_invite_submission_status(
  submission_id_input uuid,
  device_token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sub public.staff_invite_submissions;
  s public.staff;
begin
  if submission_id_input is null or device_token_input is null then
    return jsonb_build_object('status', 'invalid_input');
  end if;
  select * into sub
  from public.staff_invite_submissions
  where id = submission_id_input
    and device_token_hash = public._staff_token_hash(device_token_input);
  if sub.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if sub.status = 'pending' then
    return jsonb_build_object('status', 'pending');
  end if;
  if sub.status = 'rejected' then
    return jsonb_build_object(
      'status', 'rejected',
      'reason', sub.reject_reason
    );
  end if;
  -- approved_new или approved_attached — оба ведут к одному и тому же:
  -- линкуем на staff_id и возвращаем staff для login-state на фронте.
  if sub.linked_staff_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into s from public.staff where id = sub.linked_staff_id;
  if s.id is null or not coalesce(s.is_active, false) then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', 'approved',
    'mode', sub.status,
    'staff', public._staff_to_public_json(s)
  );
end;
$$;

revoke all on function public.staff_invite_submission_status(uuid, text) from public;
grant execute on function public.staff_invite_submission_status(uuid, text)
  to anon, authenticated;

-- ============================================================================
-- 9. Admin: список заявок
-- ============================================================================

create or replace function public.staff_invite_submissions_list(
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
      'id', sub.id,
      'invite_id', sub.invite_id,
      'submitted_name', sub.submitted_name,
      'submitted_phone', sub.submitted_phone,
      'device_kind', sub.device_kind,
      'user_agent', sub.user_agent,
      'ip_address', host(sub.ip_address),
      'status', sub.status,
      'reject_reason', sub.reject_reason,
      'linked_staff_id', sub.linked_staff_id,
      'linked_staff_name', s.name,
      'decided_by_admin_id', sub.decided_by_admin_id,
      'decided_by_admin_name', a.name,
      'decided_at', sub.decided_at,
      'created_at', sub.created_at,
      'invite_intended_role', i.intended_role,
      'invite_intended_name', i.intended_name
    )
    from public.staff_invite_submissions sub
    left join public.staff s on s.id = sub.linked_staff_id
    left join public.staff a on a.id = sub.decided_by_admin_id
    left join public.staff_invites i on i.id = sub.invite_id
    order by case when sub.status = 'pending' then 0 else 1 end,
             sub.created_at desc;
end;
$$;

revoke all on function public.staff_invite_submissions_list(uuid) from public;
grant execute on function public.staff_invite_submissions_list(uuid)
  to anon, authenticated;

-- ============================================================================
-- 10. Admin: подсказки на «привязать к существующему»
-- Возвращает топ-5 по похожести имени или совпадению последних 7 цифр
-- телефона. Намеренно простая логика, без trigram-индекса.
-- ============================================================================

create or replace function public.staff_invite_suggest_matches(
  submission_id_input uuid,
  actor_id uuid
)
returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sub public.staff_invite_submissions;
  phone_digits text;
  phone_suffix text;
begin
  perform public._staff_assert_admin(actor_id);
  select * into sub from public.staff_invite_submissions where id = submission_id_input;
  if sub.id is null then return; end if;

  phone_digits := public._staff_normalize_phone(sub.submitted_phone);
  phone_suffix := case when length(phone_digits) >= 7
                       then right(phone_digits, 7)
                       else phone_digits end;

  return query
    with scored as (
      select
        s.id,
        s.name,
        s.phone,
        s.role,
        s.roles,
        s.is_active,
        case
          when length(phone_suffix) >= 7
               and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 7) = phone_suffix
            then 100
          else 0
        end
        + case
            when lower(coalesce(s.name,'')) = lower(coalesce(sub.submitted_name,'')) then 50
            when lower(coalesce(s.name,'')) like '%' || lower(coalesce(sub.submitted_name,'')) || '%' then 25
            when lower(coalesce(sub.submitted_name,'')) like '%' || lower(coalesce(s.name,'')) || '%' then 15
            else 0
          end as score
      from public.staff s
    )
    select jsonb_build_object(
      'id', id,
      'name', name,
      'phone', phone,
      'role', role,
      'roles', roles,
      'is_active', is_active,
      'score', score
    )
    from scored
    where score > 0
    order by score desc, name asc
    limit 5;
end;
$$;

revoke all on function public.staff_invite_suggest_matches(uuid, uuid) from public;
grant execute on function public.staff_invite_suggest_matches(uuid, uuid)
  to anon, authenticated;

-- ============================================================================
-- 11. Admin: approve (создать нового или привязать к существующему)
--   action_input:
--     'create_new'  → новый staff(name=submitted_name, phone=submitted_phone, role=intended_role|'worker')
--     'attach'      → linked_staff_id := target_staff_id_input
--   В обоих случаях создаём строку в staff_trusted_devices с device_token_hash
--   из заявки, is_salon_device=(device_kind='salon').
-- ============================================================================

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
  device_label := coalesce(nullif(trim(sub.submitted_name), ''), 'Invited device');

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
    -- create_new
    resolved_role := coalesce(nullif(trim(coalesce(inv.intended_role, '')), ''), 'worker');
    -- Разрешаем только три значения, всё остальное → 'worker'.
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

  -- Разворачиваем «временный» device_token в полноценное доверенное устройство.
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

revoke all on function public.staff_invite_approve_submission(uuid, uuid, text, uuid) from public;
grant execute on function public.staff_invite_approve_submission(uuid, uuid, text, uuid)
  to anon, authenticated;

-- ============================================================================
-- 12. Admin: reject заявку
-- ============================================================================

create or replace function public.staff_invite_reject_submission(
  submission_id_input uuid,
  actor_id uuid,
  reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_admin(actor_id);
  update public.staff_invite_submissions
    set status = 'rejected',
        reject_reason = nullif(trim(coalesce(reason_input, '')), ''),
        decided_by_admin_id = actor_id,
        decided_at = now()
    where id = submission_id_input
      and status = 'pending';
  if not found then
    return jsonb_build_object('status', 'not_pending');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_invite_reject_submission(uuid, uuid, text) from public;
grant execute on function public.staff_invite_reject_submission(uuid, uuid, text)
  to anon, authenticated;

commit;
