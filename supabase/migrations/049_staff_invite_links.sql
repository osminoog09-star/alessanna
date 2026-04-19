-- 049_staff_invite_links.sql
-- ============================================================================
-- Пригласительные ссылки для сотрудников.
--
-- ЗАЧЕМ: вместо того чтобы созваниваться с мастером и диктовать ему PIN,
-- админ хочет нажать «Пригласить» рядом с конкретным сотрудником, получить
-- одноразовую ссылку и просто отправить её в WhatsApp/Telegram. Мастер
-- открывает ссылку → автоматически логинится → его устройство сразу же
-- становится доверенным. Ввод пароля/PIN не требуется.
--
-- БЕЗОПАСНОСТЬ:
--   – токен 24 случайных байта (32 base64-url) → невозможно угадать.
--   – в БД храним только sha256-хеш токена. Plaintext отдаётся ТОЛЬКО админу,
--     один раз при создании. После — даже сам админ его уже не увидит.
--   – по умолчанию max_uses=1 и expires_at = now()+24h. Можно переопределить.
--   – revoke в любой момент (на случай «отправил не тому»).
--   – все попытки использования логируются (uses_count, last_used_at, ip).
--
-- ВНУТРИ:
--   – staff_consume_invite публичен (anon), но безопасен:
--     * требует валидный неиспользованный неотозванный непросроченный токен;
--     * атомарно инкрементит uses_count (защита от двойного использования);
--     * сразу создаёт trusted_device для целевого staff и возвращает токен
--       устройства — фронт сохраняет его и работает дальше как после login.
-- ============================================================================

begin;

create table if not exists public.staff_invite_links (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  token_hash text not null,
  created_by_admin_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses >= 1 and max_uses <= 100),
  uses_count int not null default 0,
  last_used_at timestamptz,
  last_used_ip inet,
  note text,
  revoked_at timestamptz,
  constraint staff_invite_links_token_unique unique (token_hash)
);

create index if not exists staff_invite_links_staff_idx
  on public.staff_invite_links (staff_id) where revoked_at is null;
create index if not exists staff_invite_links_active_idx
  on public.staff_invite_links (expires_at)
  where revoked_at is null;

comment on table public.staff_invite_links is
  'Одноразовые/временные ссылки для логина сотрудника без PIN. Plaintext-токен в БД не хранится — только sha256-хеш.';

alter table public.staff_invite_links enable row level security;

drop policy if exists staff_invite_links_no_direct on public.staff_invite_links;
create policy staff_invite_links_no_direct
  on public.staff_invite_links
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- Создание приглашения (admin-only)
-- ============================================================================

create or replace function public.staff_admin_create_invite(
  actor_id uuid,
  target_staff_id uuid,
  expires_in_minutes int default 1440,  -- 24 часа по умолчанию
  max_uses_input int default 1,
  note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target public.staff;
  new_token text;
  new_token_hash text;
  new_id uuid;
  expires timestamptz;
  capped_max_uses int;
  capped_minutes int;
begin
  perform public._staff_assert_admin(actor_id);

  select * into target from public.staff where id = target_staff_id;
  if target.id is null then
    return jsonb_build_object('status', 'staff_not_found');
  end if;
  if target.is_active is not true then
    return jsonb_build_object('status', 'staff_inactive');
  end if;

  -- Защита от глупых параметров.
  capped_minutes := greatest(5, least(coalesce(expires_in_minutes, 1440), 60 * 24 * 30));
  capped_max_uses := greatest(1, least(coalesce(max_uses_input, 1), 100));
  expires := now() + make_interval(mins => capped_minutes);

  new_token := encode(gen_random_bytes(24), 'base64');
  new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');
  new_token_hash := public._staff_token_hash(new_token);

  insert into public.staff_invite_links (
    staff_id, token_hash, created_by_admin_id, expires_at, max_uses, note
  ) values (
    target_staff_id, new_token_hash, actor_id, expires, capped_max_uses,
    nullif(trim(coalesce(note_input, '')), '')
  )
  returning id into new_id;

  return jsonb_build_object(
    'status', 'ok',
    'invite_id', new_id,
    'token', new_token,
    'expires_at', expires,
    'max_uses', capped_max_uses,
    'staff_id', target_staff_id,
    'staff_name', target.name
  );
end;
$$;

revoke all on function public.staff_admin_create_invite(uuid, uuid, int, int, text) from public;
grant execute on function public.staff_admin_create_invite(uuid, uuid, int, int, text)
  to anon, authenticated;

-- ============================================================================
-- Список приглашений (admin-only)
-- ============================================================================

create or replace function public.staff_admin_list_invites(
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
      'staff_id', i.staff_id,
      'staff_name', s.name,
      'created_by_admin_id', i.created_by_admin_id,
      'created_by_admin_name', a.name,
      'created_at', i.created_at,
      'expires_at', i.expires_at,
      'max_uses', i.max_uses,
      'uses_count', i.uses_count,
      'last_used_at', i.last_used_at,
      'last_used_ip', host(i.last_used_ip),
      'note', i.note,
      'revoked_at', i.revoked_at,
      -- Удобный «статус» для UI:
      --   active  → ещё можно использовать
      --   used_up → max_uses исчерпан
      --   expired → дата прошла
      --   revoked → админ отозвал
      'status', case
        when i.revoked_at is not null then 'revoked'
        when i.uses_count >= i.max_uses then 'used_up'
        when i.expires_at <= now() then 'expired'
        else 'active'
      end
    )
    from public.staff_invite_links i
    left join public.staff s on s.id = i.staff_id
    left join public.staff a on a.id = i.created_by_admin_id
    order by
      (case when i.revoked_at is null
             and i.uses_count < i.max_uses
             and i.expires_at > now()
            then 0 else 1 end),
      i.created_at desc;
end;
$$;

revoke all on function public.staff_admin_list_invites(uuid) from public;
grant execute on function public.staff_admin_list_invites(uuid)
  to anon, authenticated;

-- ============================================================================
-- Отзыв приглашения (admin-only)
-- ============================================================================

create or replace function public.staff_admin_revoke_invite(
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
  update public.staff_invite_links
    set revoked_at = now()
    where id = invite_id_input
      and revoked_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found_or_already_revoked');
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.staff_admin_revoke_invite(uuid, uuid) from public;
grant execute on function public.staff_admin_revoke_invite(uuid, uuid)
  to anon, authenticated;

-- ============================================================================
-- Использование приглашения (public)
-- ============================================================================

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

  -- Атомарно: одной транзакцией находим, проверяем и инкрементим, чтобы
  -- двойное использование одного токена не прошло из двух вкладок одновременно.
  -- FOR UPDATE сериализует параллельные обращения к одной строке.
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

  -- Инкрементим счётчик использования.
  update public.staff_invite_links
    set uses_count = uses_count + 1,
        last_used_at = now(),
        last_used_ip = client_ip
    where id = inv_id;

  -- Создаём доверенное устройство и возвращаем токен фронту.
  new_device_token := encode(gen_random_bytes(24), 'base64');
  new_device_token := replace(replace(replace(new_device_token, '+', '-'), '/', '_'), '=', '');
  new_device_hash := public._staff_token_hash(new_device_token);

  insert into public.staff_trusted_devices (
    staff_id, device_token_hash, label, user_agent, ip_address, last_seen_at
  ) values (
    inv_staff_id,
    new_device_hash,
    coalesce(nullif(trim(device_label), ''), 'Invite link'),
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

revoke all on function public.staff_consume_invite(text, text, text) from public;
grant execute on function public.staff_consume_invite(text, text, text)
  to anon, authenticated;

commit;
