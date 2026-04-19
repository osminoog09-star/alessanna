-- 038_support_assignment_ids_ip_stats.sql
--
-- Поддержка: «закрепить за собой» с историей назначения, человекочитаемые
-- ID треда (SAL-000123 / SIT-000045 / EMP-000012), IP/устройство клиента
-- для отлова мошенников, агрегаты для дашборда.
--
-- Принципы:
--   * Идемпотентно — миграцию можно прогнать несколько раз.
--   * Прямой доступ к таблицам остаётся закрыт RLS (см. 023). Всё через RPC.
--   * IP читаем из заголовков PostgREST (request.headers — JSON с
--     x-forwarded-for / cf-connecting-ip), пишем сразу при создании треда.
--     Для уже существующих тредов остаётся NULL — это норма.
--   * IP показываем только админу. Менеджер видит обезличенные счётчики
--     («3 обращения за 24 часа с того же устройства»).
--   * Подозрительный = ≥ 5 тредов за последние 24 часа с одного IP
--     или с того же device_fingerprint.
--   * Передачу обращения чужому ассайни может выполнить ТОЛЬКО admin
--     (менеджер может только взять «себе» свободный тред и снять «с себя»).

set search_path = public, pg_temp;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Колонки support_threads
-- ──────────────────────────────────────────────────────────────────────────

alter table public.support_threads
  add column if not exists display_id text,
  add column if not exists client_ip inet,
  add column if not exists client_ip_set_at timestamptz,
  add column if not exists device_fingerprint text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by_staff_id uuid references public.staff(id) on delete set null;

create unique index if not exists support_threads_display_id_uidx
  on public.support_threads (display_id)
  where display_id is not null;

create index if not exists support_threads_client_ip_idx
  on public.support_threads (client_ip, created_at desc)
  where client_ip is not null;

create index if not exists support_threads_device_fp_idx
  on public.support_threads (device_fingerprint, created_at desc)
  where device_fingerprint is not null;

create index if not exists support_threads_assignee_idx
  on public.support_threads (assigned_staff_id, status);

comment on column public.support_threads.display_id is
  'Человекочитаемый id вида SAL-000123 / SIT-000045 / EMP-000012, генерится триггером.';
comment on column public.support_threads.client_ip is
  'IP клиента в момент создания (только для admin). Пишется из x-forwarded-for / cf-connecting-ip.';
comment on column public.support_threads.device_fingerprint is
  'sha256(user_agent + accept_language) — обезличенный отпечаток для определения повторных обращений.';
comment on column public.support_threads.assigned_at is
  'Когда тред был назначен текущему ассайни. Очищается при снятии.';
comment on column public.support_threads.assigned_by_staff_id is
  'Кто закрепил/перезакрепил тред. NULL = взято самим собой.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Sequences для display_id (по одной на тему)
-- ──────────────────────────────────────────────────────────────────────────

create sequence if not exists public.support_seq_salon start 1;
create sequence if not exists public.support_seq_site  start 1;
create sequence if not exists public.support_seq_staff start 1;

create or replace function public._support_topic_prefix(p_topic text)
returns text
language sql
immutable
as $$
  select case p_topic
    when 'salon' then 'SAL'
    when 'site'  then 'SIT'
    when 'staff' then 'EMP'
    else 'SUP'
  end;
$$;

create or replace function public._support_assign_display_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_n bigint;
begin
  if new.display_id is not null and new.display_id <> '' then
    return new;
  end if;
  v_prefix := public._support_topic_prefix(new.topic);
  v_n := case new.topic
    when 'salon' then nextval('public.support_seq_salon')
    when 'site'  then nextval('public.support_seq_site')
    when 'staff' then nextval('public.support_seq_staff')
    else nextval('public.support_seq_salon')
  end;
  new.display_id := v_prefix || '-' || lpad(v_n::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists trg_support_assign_display_id on public.support_threads;
create trigger trg_support_assign_display_id
  before insert on public.support_threads
  for each row execute function public._support_assign_display_id();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Backfill display_id для уже созданных тредов (по дате — стабильно)
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_seq text;
  v_n bigint;
  v_prefix text;
begin
  for r in
    select id, topic, created_at
    from public.support_threads
    where display_id is null
    order by topic, created_at, id
  loop
    v_prefix := public._support_topic_prefix(r.topic);
    v_seq := case r.topic
      when 'salon' then 'public.support_seq_salon'
      when 'site'  then 'public.support_seq_site'
      when 'staff' then 'public.support_seq_staff'
      else 'public.support_seq_salon'
    end;
    execute format('select nextval(%L)', v_seq) into v_n;
    update public.support_threads
      set display_id = v_prefix || '-' || lpad(v_n::text, 6, '0')
      where id = r.id;
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Helper: вытащить IP клиента из заголовков PostgREST
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public._support_request_ip()
returns inet
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_headers text;
  v_raw text;
  v_first text;
begin
  begin
    v_headers := current_setting('request.headers', true);
  exception when others then
    return null;
  end;

  if v_headers is null or v_headers = '' then
    return null;
  end if;

  -- Cloudflare даёт настоящий IP в cf-connecting-ip
  v_raw := nullif(trim((v_headers::json) ->> 'cf-connecting-ip'), '');
  if v_raw is null then
    -- Supabase / Vercel / Nginx — в x-forwarded-for, левый адрес = клиент
    v_raw := nullif(trim((v_headers::json) ->> 'x-forwarded-for'), '');
  end if;
  if v_raw is null then
    v_raw := nullif(trim((v_headers::json) ->> 'x-real-ip'), '');
  end if;
  if v_raw is null then
    return null;
  end if;

  v_first := trim(split_part(v_raw, ',', 1));
  if v_first = '' then
    return null;
  end if;

  begin
    return v_first::inet;
  exception when others then
    return null;
  end;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Обновляем publisher RPC: visitor_start_thread пишет IP + fingerprint
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.support_visitor_start_thread(
  p_session_token text,
  p_topic text,
  p_name text,
  p_email text,
  p_message text,
  p_user_agent text default null,
  p_origin_url text default null,
  p_attachment_url text default null,
  p_attachment_name text default null,
  p_attachment_mime text default null,
  p_attachment_size_bytes int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread_id uuid;
  v_name text;
  v_email text;
  v_message text;
  v_topic text;
  v_ip inet;
  v_fp text;
  v_ua text;
begin
  if p_session_token is null or char_length(p_session_token) < 16 then
    raise exception 'invalid_session_token';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'invalid_name';
  end if;

  v_email := nullif(trim(coalesce(p_email, '')), '');
  if v_email is not null and char_length(v_email) > 200 then
    raise exception 'invalid_email';
  end if;

  v_message := trim(coalesce(p_message, ''));
  if v_message = '' and p_attachment_url is null then
    raise exception 'invalid_message';
  end if;
  if char_length(coalesce(v_message, '')) > 4000 then
    raise exception 'message_too_long';
  end if;

  v_topic := coalesce(nullif(p_topic, ''), 'salon');
  if v_topic not in ('salon','site') then
    v_topic := 'salon';
  end if;

  v_ua := left(coalesce(p_user_agent, ''), 500);
  v_ip := public._support_request_ip();
  /* device fingerprint = sha256(UA + ',' + accept-language). Это не PII, но
     стабильнее, чем просто UA — отличает разные браузеры на одном IP. */
  v_fp := encode(
    digest(
      v_ua || ',' || coalesce(
        (current_setting('request.headers', true)::json) ->> 'accept-language', ''
      ),
      'sha256'
    ),
    'hex'
  );

  select id into v_thread_id
    from public.support_threads
    where visitor_session_token = p_session_token;

  if v_thread_id is null then
    insert into public.support_threads (
      topic, visitor_name, visitor_email, visitor_session_token,
      visitor_user_agent, visitor_origin_url,
      client_ip, client_ip_set_at, device_fingerprint
    )
    values (
      v_topic, v_name, v_email, p_session_token,
      v_ua, left(coalesce(p_origin_url, ''), 500),
      v_ip, case when v_ip is not null then now() else null end, v_fp
    )
    returning id into v_thread_id;
  else
    update public.support_threads
    set visitor_name = v_name,
        visitor_email = coalesce(v_email, visitor_email),
        topic = v_topic,
        client_ip = coalesce(v_ip, client_ip),
        client_ip_set_at = case
          when v_ip is not null and client_ip is distinct from v_ip then now()
          else client_ip_set_at
        end,
        device_fingerprint = coalesce(device_fingerprint, v_fp)
    where id = v_thread_id;
  end if;

  insert into public.support_messages (
    thread_id, sender_type, body,
    attachment_url, attachment_name, attachment_mime, attachment_size_bytes
  )
  values (
    v_thread_id, 'visitor', v_message,
    p_attachment_url, p_attachment_name, p_attachment_mime, p_attachment_size_bytes
  );

  return jsonb_build_object('thread_id', v_thread_id);
end;
$$;

grant execute on function public.support_visitor_start_thread(
  text, text, text, text, text, text, text, text, text, text, int
) to anon, authenticated;

-- staff_self_open: тоже фиксируем IP/fp (для аудита: с какого устройства
-- сотрудник открыл тикет). Это не «мошенник», но полезно при разборах.
create or replace function public.support_staff_self_open(
  p_staff_id uuid,
  p_body text,
  p_attachment_url text default null,
  p_attachment_name text default null,
  p_attachment_mime text default null,
  p_attachment_size_bytes int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_thread_id uuid;
  v_body text;
  v_token text;
  v_ip inet;
  v_fp text;
begin
  select id, name, phone, (
    'admin' = any(coalesce(roles, array[]::text[]))
    or role = 'admin'
    or 'owner' = any(coalesce(roles, array[]::text[]))
    or role = 'owner'
  ) as is_admin
  into v_staff
  from public.staff
  where id = p_staff_id and is_active = true;
  if v_staff.id is null then
    raise exception 'access_denied';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' and p_attachment_url is null then
    raise exception 'invalid_body';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'body_too_long';
  end if;

  v_ip := public._support_request_ip();
  v_fp := encode(
    digest(
      coalesce((current_setting('request.headers', true)::json) ->> 'user-agent', '')
        || ',' ||
      coalesce((current_setting('request.headers', true)::json) ->> 'accept-language', ''),
      'sha256'
    ),
    'hex'
  );

  select id into v_thread_id
  from public.support_threads
  where staff_author_id = p_staff_id
    and topic = 'staff'
    and status in ('open', 'pending')
  order by updated_at desc
  limit 1;

  if v_thread_id is null then
    v_token := 'staff:' || p_staff_id::text || ':' || replace(gen_random_uuid()::text, '-', '');
    insert into public.support_threads (
      topic, status,
      visitor_name, visitor_email, visitor_session_token,
      staff_author_id,
      client_ip, client_ip_set_at, device_fingerprint
    )
    values (
      'staff', 'open',
      v_staff.name, v_staff.phone, v_token,
      p_staff_id,
      v_ip, case when v_ip is not null then now() else null end, v_fp
    )
    returning id into v_thread_id;
  end if;

  insert into public.support_messages (
    thread_id, sender_type, sender_staff_id, body,
    attachment_url, attachment_name, attachment_mime, attachment_size_bytes
  )
  values (
    v_thread_id, 'visitor', p_staff_id, v_body,
    p_attachment_url, p_attachment_name, p_attachment_mime, p_attachment_size_bytes
  );

  return jsonb_build_object('thread_id', v_thread_id);
end;
$$;

grant execute on function public.support_staff_self_open(
  uuid, text, text, text, text, int
) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Списки для staff: добавляем display_id + assignee + suspicious-флаг
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.support_staff_list_threads(
  p_staff_id uuid,
  p_status_filter text default null,
  p_topic_filter text default null,
  p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_allowed text[];
  v_result jsonb;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then
    raise exception 'access_denied';
  end if;

  if v_ctx.is_admin then
    v_allowed := array['salon', 'site', 'staff'];
  elsif v_ctx.is_manager then
    v_allowed := array['salon'];
  else
    raise exception 'access_denied';
  end if;

  if p_topic_filter is not null and p_topic_filter != '' then
    if not (p_topic_filter = any(v_allowed)) then
      raise exception 'access_denied';
    end if;
    v_allowed := array[p_topic_filter];
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.updated_at desc), '[]'::jsonb)
  into v_result
  from (
    select t.id, t.display_id, t.created_at, t.updated_at, t.topic, t.status,
           t.visitor_name, t.visitor_email, t.last_message_at,
           t.last_message_preview, t.last_sender_type,
           t.unread_for_staff,
           t.assigned_staff_id,
           t.assigned_at,
           sa.name as assigned_staff_name,
           t.staff_author_id,
           sau.name as staff_author_name,
           /* «Подозрительно»: ≥5 тредов за 24ч с того же IP ИЛИ с того же
              fingerprint. Считаем только не-staff темы — у сотрудников
              это нормально. Менеджер увидит флаг, но не сам IP. */
           case
             when t.topic = 'staff' then false
             when t.client_ip is not null and (
                  select count(*) from public.support_threads x
                  where x.client_ip = t.client_ip
                    and x.created_at > now() - interval '24 hours'
                    and x.topic <> 'staff'
                ) >= 5 then true
             when t.device_fingerprint is not null and (
                  select count(*) from public.support_threads x
                  where x.device_fingerprint = t.device_fingerprint
                    and x.created_at > now() - interval '24 hours'
                    and x.topic <> 'staff'
                ) >= 5 then true
             else false
           end as is_suspicious
    from public.support_threads t
    left join public.staff sa  on sa.id  = t.assigned_staff_id
    left join public.staff sau on sau.id = t.staff_author_id
    where t.topic = any(v_allowed)
      and (p_status_filter is null or p_status_filter = '' or t.status = p_status_filter)
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return v_result;
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Деталь треда: возвращаем display_id, assignee, IP (только admin),
--    счётчики «с этого устройства» и suspicious-флаг.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.support_staff_fetch_messages(
  p_staff_id uuid,
  p_thread_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_thread public.support_threads%rowtype;
  v_messages jsonb;
  v_assignee_name text;
  v_assigned_by_name text;
  v_author_name text;
  v_ip_threads_24h int := 0;
  v_fp_threads_24h int := 0;
  v_is_suspicious boolean := false;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;

  if v_thread.topic in ('site', 'staff') and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  select name into v_assignee_name
    from public.staff where id = v_thread.assigned_staff_id;
  select name into v_assigned_by_name
    from public.staff where id = v_thread.assigned_by_staff_id;
  select name into v_author_name
    from public.staff where id = v_thread.staff_author_id;

  if v_thread.client_ip is not null then
    select count(*)::int into v_ip_threads_24h
    from public.support_threads
    where client_ip = v_thread.client_ip
      and created_at > now() - interval '24 hours'
      and topic <> 'staff';
  end if;
  if v_thread.device_fingerprint is not null then
    select count(*)::int into v_fp_threads_24h
    from public.support_threads
    where device_fingerprint = v_thread.device_fingerprint
      and created_at > now() - interval '24 hours'
      and topic <> 'staff';
  end if;
  v_is_suspicious := v_thread.topic <> 'staff'
    and (v_ip_threads_24h >= 5 or v_fp_threads_24h >= 5);

  select coalesce(jsonb_agg(row_to_json(m) order by m.created_at asc), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.created_at, m.sender_type, m.sender_staff_id, m.body,
           m.attachment_url, m.attachment_name, m.attachment_mime, m.attachment_size_bytes,
           s.name as sender_staff_name
    from public.support_messages m
    left join public.staff s on s.id = m.sender_staff_id
    where m.thread_id = p_thread_id
    order by m.created_at asc
  ) m;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', v_thread.id,
      'display_id', v_thread.display_id,
      'topic', v_thread.topic,
      'status', v_thread.status,
      'visitor_name', v_thread.visitor_name,
      'visitor_email', v_thread.visitor_email,
      'visitor_user_agent', v_thread.visitor_user_agent,
      'visitor_origin_url', v_thread.visitor_origin_url,
      'created_at', v_thread.created_at,
      'updated_at', v_thread.updated_at,
      'last_message_at', v_thread.last_message_at,
      'unread_for_staff', v_thread.unread_for_staff,
      'assigned_staff_id', v_thread.assigned_staff_id,
      'assigned_staff_name', v_assignee_name,
      'assigned_at', v_thread.assigned_at,
      'assigned_by_staff_id', v_thread.assigned_by_staff_id,
      'assigned_by_staff_name', v_assigned_by_name,
      'staff_author_id', v_thread.staff_author_id,
      'staff_author_name', v_author_name,
      /* IP — только админу. Менеджер видит только обезличенные счётчики. */
      'client_ip', case when v_ctx.is_admin then host(v_thread.client_ip) else null end,
      'client_ip_set_at', case when v_ctx.is_admin then v_thread.client_ip_set_at else null end,
      'device_fingerprint_short',
        case when v_thread.device_fingerprint is null then null
             else left(v_thread.device_fingerprint, 10) end,
      'ip_threads_24h', v_ip_threads_24h,
      'device_threads_24h', v_fp_threads_24h,
      'is_suspicious', v_is_suspicious
    ),
    'messages', v_messages
  );
end;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. update_thread: расширяем — clear_assignee, права «передать другому»
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.support_staff_update_thread(
  p_staff_id uuid,
  p_thread_id uuid,
  p_status text default null,
  p_assigned_staff_id uuid default null,
  p_clear_unread boolean default false,
  p_clear_assignee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_thread public.support_threads%rowtype;
  v_target uuid;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;
  if v_thread.topic in ('site', 'staff') and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  if p_status is not null and p_status != '' then
    if p_status not in ('open', 'pending', 'closed') then
      raise exception 'invalid_status';
    end if;
    update public.support_threads set status = p_status where id = p_thread_id;
  end if;

  /* Снять с себя — может любой ассайни (или admin). Менеджер не может снять
     чужое назначение и не может перевесить чужой тред. */
  if p_clear_assignee then
    if v_thread.assigned_staff_id is not null
       and v_thread.assigned_staff_id <> p_staff_id
       and not v_ctx.is_admin then
      raise exception 'access_denied';
    end if;
    update public.support_threads
      set assigned_staff_id = null,
          assigned_at = null,
          assigned_by_staff_id = null
      where id = p_thread_id;
  elsif p_assigned_staff_id is not null then
    v_target := p_assigned_staff_id;
    /* Менеджер может назначить только себя (взять свободный тред себе)
       или перехватить тред, который уже назначен ему же (no-op). Любая
       попытка назначить кого-то другого / перехватить чужой — только admin. */
    if not v_ctx.is_admin then
      if v_target <> p_staff_id then
        raise exception 'access_denied';
      end if;
      if v_thread.assigned_staff_id is not null
         and v_thread.assigned_staff_id <> p_staff_id then
        raise exception 'access_denied';
      end if;
    end if;
    update public.support_threads
      set assigned_staff_id = v_target,
          assigned_at = now(),
          assigned_by_staff_id = case
            when v_target = p_staff_id then null  -- взял себе
            else p_staff_id                       -- кто-то закрепил кого-то
          end
      where id = p_thread_id;
  end if;

  if p_clear_unread then
    update public.support_threads set unread_for_staff = false where id = p_thread_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.support_staff_update_thread(
  uuid, uuid, text, uuid, boolean, boolean
) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. Stats для дашборда над списком
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.support_staff_stats(
  p_staff_id uuid,
  p_topic_filter text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_allowed text[];
  v_open int := 0;
  v_pending int := 0;
  v_unassigned int := 0;
  v_mine int := 0;
  v_avg_first_response interval;
  v_closed_24h int := 0;
  v_closed_7d int := 0;
  v_suspicious int := 0;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;

  if v_ctx.is_admin then
    v_allowed := array['salon', 'site', 'staff'];
  elsif v_ctx.is_manager then
    v_allowed := array['salon'];
  else
    raise exception 'access_denied';
  end if;

  if p_topic_filter is not null and p_topic_filter <> '' then
    if not (p_topic_filter = any(v_allowed)) then
      raise exception 'access_denied';
    end if;
    v_allowed := array[p_topic_filter];
  end if;

  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status in ('open','pending') and assigned_staff_id is null),
    count(*) filter (where status in ('open','pending') and assigned_staff_id = p_staff_id)
  into v_open, v_pending, v_unassigned, v_mine
  from public.support_threads
  where topic = any(v_allowed);

  /* Среднее время первого ответа staff'а: для каждого треда берём первое
     сообщение от staff и сравниваем с created_at треда. Окно — 30 дней,
     чтобы не тащить всю историю. */
  select avg(first_reply.first_at - t.created_at)
  into v_avg_first_response
  from public.support_threads t
  join lateral (
    select min(m.created_at) as first_at
    from public.support_messages m
    where m.thread_id = t.id and m.sender_type = 'staff'
  ) first_reply on true
  where t.topic = any(v_allowed)
    and t.created_at > now() - interval '30 days'
    and first_reply.first_at is not null;

  select
    count(*) filter (where status = 'closed' and updated_at > now() - interval '24 hours'),
    count(*) filter (where status = 'closed' and updated_at > now() - interval '7 days')
  into v_closed_24h, v_closed_7d
  from public.support_threads
  where topic = any(v_allowed);

  select count(*) into v_suspicious
  from public.support_threads t
  where t.topic = any(v_allowed)
    and t.topic <> 'staff'
    and t.created_at > now() - interval '24 hours'
    and (
      (t.client_ip is not null and (
        select count(*) from public.support_threads x
        where x.client_ip = t.client_ip
          and x.created_at > now() - interval '24 hours'
          and x.topic <> 'staff'
      ) >= 5)
      or
      (t.device_fingerprint is not null and (
        select count(*) from public.support_threads x
        where x.device_fingerprint = t.device_fingerprint
          and x.created_at > now() - interval '24 hours'
          and x.topic <> 'staff'
      ) >= 5)
    );

  return jsonb_build_object(
    'open', v_open,
    'pending', v_pending,
    'unassigned', v_unassigned,
    'mine', v_mine,
    'avg_first_response_seconds',
      case when v_avg_first_response is null then null
           else extract(epoch from v_avg_first_response)::int end,
    'closed_24h', v_closed_24h,
    'closed_7d', v_closed_7d,
    'suspicious_24h', v_suspicious
  );
end;
$$;

grant execute on function public.support_staff_stats(uuid, text) to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
--   select display_id, topic, status, client_ip, assigned_staff_id
--     from public.support_threads order by created_at desc limit 5;
--   select public.support_staff_stats('<denis-admin-id>', null);
--   select public.support_staff_list_threads('<denis-admin-id>', null, null, 10);
-- ──────────────────────────────────────────────────────────────────────────
