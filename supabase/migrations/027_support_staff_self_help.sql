-- 027_support_staff_self_help.sql
-- Внутренняя техподдержка для сотрудников салона.
--
-- Ранее `support_threads.topic` имел два значения:
--   * 'salon' — вопросы клиентов в салон (менеджеры + админы)
--   * 'site'  — техподдержка сайта от клиентов (только админы)
--
-- Теперь появляется третий:
--   * 'staff' — сотрудник салона пишет в тех. поддержку (баг, поломка, просьба)
--     Видят только админы. Менеджеры **НЕ видят** — это не их зона.
--
-- В существующей схеме `sender_type` принимает значения visitor|staff|system.
-- Для тем 'staff' автор-сотрудник шлёт сообщения как sender_type='visitor'
-- (семантически «со стороны обратившегося») + `sender_staff_id = автор`,
-- а админ отвечает обычным sender_type='staff'. Это позволяет переиспользовать
-- триггер `support_after_message_insert` без изменений: автор — «условный
-- посетитель», поэтому `unread_for_visitor` работает как «непрочитано автором»,
-- а `unread_for_staff` — «непрочитано админом».
--
-- Миграция идемпотентна: безопасно применять повторно.

-- ------------------------------------------------------------------
-- 1. Расширяем CHECK-ограничение `topic`.
-- ------------------------------------------------------------------
do $$
declare
  v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'support_threads'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%topic%';
  if v_con is not null then
    execute format('alter table public.support_threads drop constraint %I', v_con);
  end if;
end $$;

alter table public.support_threads
  add constraint support_threads_topic_check
  check (topic in ('salon', 'site', 'staff'));

-- ------------------------------------------------------------------
-- 2. Автор-сотрудник для тем 'staff'.
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'support_threads'
      and column_name = 'staff_author_id'
  ) then
    alter table public.support_threads
      add column staff_author_id uuid references public.staff(id) on delete set null;
  end if;
end $$;

create index if not exists support_threads_staff_author_idx
  on public.support_threads (staff_author_id, updated_at desc)
  where staff_author_id is not null;

comment on column public.support_threads.staff_author_id is
  'When topic=staff, points to the employee who opened the thread. Null for salon/site topics.';

-- ------------------------------------------------------------------
-- 3. Админский список: добавляем доступ к теме 'staff'.
-- ------------------------------------------------------------------
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
    select t.id, t.created_at, t.updated_at, t.topic, t.status,
           t.visitor_name, t.visitor_email, t.last_message_at,
           t.last_message_preview, t.last_sender_type,
           t.unread_for_staff, t.assigned_staff_id,
           t.staff_author_id,
           sa.name as staff_author_name
    from public.support_threads t
    left join public.staff sa on sa.id = t.staff_author_id
    where t.topic = any(v_allowed)
      and (p_status_filter is null or p_status_filter = '' or t.status = p_status_filter)
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return v_result;
end;
$$;

-- ------------------------------------------------------------------
-- 4. Бейдж непрочитанных (админ теперь видит и 'staff').
-- ------------------------------------------------------------------
create or replace function public.support_staff_unread_count(p_staff_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_allowed text[];
  v_count int;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then
    return 0;
  end if;

  if v_ctx.is_admin then
    v_allowed := array['salon', 'site', 'staff'];
  elsif v_ctx.is_manager then
    v_allowed := array['salon'];
  else
    return 0;
  end if;

  select count(*)::int into v_count
  from public.support_threads
  where unread_for_staff = true
    and status != 'closed'
    and topic = any(v_allowed);

  return v_count;
end;
$$;

-- ------------------------------------------------------------------
-- 5. fetch_messages: 'staff' доступен только admin.
-- ------------------------------------------------------------------
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
  v_author_name text;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;

  if v_thread.topic in ('site', 'staff') and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  select name into v_author_name from public.staff where id = v_thread.staff_author_id;

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
      'staff_author_id', v_thread.staff_author_id,
      'staff_author_name', v_author_name
    ),
    'messages', v_messages
  );
end;
$$;

-- ------------------------------------------------------------------
-- 6. staff post / update thread: запрещаем 'staff' всем, кроме admin.
-- ------------------------------------------------------------------
create or replace function public.support_staff_post_message(
  p_staff_id uuid,
  p_thread_id uuid,
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
  v_ctx record;
  v_thread public.support_threads%rowtype;
  v_body text;
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;
  if v_thread.topic in ('site', 'staff') and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' and p_attachment_url is null then
    raise exception 'invalid_body';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'body_too_long';
  end if;

  insert into public.support_messages (
    thread_id, sender_type, sender_staff_id, body,
    attachment_url, attachment_name, attachment_mime, attachment_size_bytes
  )
  values (
    p_thread_id, 'staff', p_staff_id, v_body,
    p_attachment_url, p_attachment_name, p_attachment_mime, p_attachment_size_bytes
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.support_staff_update_thread(
  p_staff_id uuid,
  p_thread_id uuid,
  p_status text default null,
  p_assigned_staff_id uuid default null,
  p_clear_unread boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_thread public.support_threads%rowtype;
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

  if p_assigned_staff_id is not null then
    update public.support_threads set assigned_staff_id = p_assigned_staff_id
      where id = p_thread_id;
  end if;

  if p_clear_unread then
    update public.support_threads set unread_for_staff = false where id = p_thread_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------
-- 7. RPC для автора-сотрудника: открыть/писать/читать свой тред.
--    Визитор-токен генерируем синтетический: `staff:<uuid>`.
-- ------------------------------------------------------------------
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
begin
  /* Любой активный сотрудник может писать в тех. поддержку — админы, менеджеры,
     мастера. Ограничений по роли здесь нет. */
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

  /* Ищем существующий открытый/ожидающий тред этого автора. Если закрыт —
     откроем новый, чтобы у админа была чистая история. */
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
      staff_author_id
    )
    values (
      'staff', 'open',
      v_staff.name, v_staff.phone, v_token,
      p_staff_id
    )
    returning id into v_thread_id;
  end if;

  /* Сообщение от автора считаем `visitor` — триггер корректно выставит
     `unread_for_staff = true` (для админа) и оставит `unread_for_visitor`
     у автора без изменений (это их собственное сообщение). */
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

create or replace function public.support_staff_self_post(
  p_staff_id uuid,
  p_thread_id uuid,
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
  v_thread public.support_threads%rowtype;
  v_body text;
begin
  if p_staff_id is null then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads
  where id = p_thread_id and staff_author_id = p_staff_id and topic = 'staff';
  if v_thread.id is null then
    raise exception 'thread_not_found';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' and p_attachment_url is null then
    raise exception 'invalid_body';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'body_too_long';
  end if;

  insert into public.support_messages (
    thread_id, sender_type, sender_staff_id, body,
    attachment_url, attachment_name, attachment_mime, attachment_size_bytes
  )
  values (
    p_thread_id, 'visitor', p_staff_id, v_body,
    p_attachment_url, p_attachment_name, p_attachment_mime, p_attachment_size_bytes
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.support_staff_self_post(
  uuid, uuid, text, text, text, text, int
) to anon, authenticated;

create or replace function public.support_staff_self_list(p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_staff_id is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.updated_at desc), '[]'::jsonb)
  into v_result
  from (
    select t.id, t.created_at, t.updated_at, t.status,
           t.last_message_at, t.last_message_preview, t.last_sender_type,
           t.unread_for_visitor
    from public.support_threads t
    where t.staff_author_id = p_staff_id
      and t.topic = 'staff'
    order by t.updated_at desc
    limit 50
  ) t;

  return v_result;
end;
$$;

grant execute on function public.support_staff_self_list(uuid) to anon, authenticated;

create or replace function public.support_staff_self_fetch(
  p_staff_id uuid,
  p_thread_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.support_threads%rowtype;
  v_messages jsonb;
begin
  if p_staff_id is null then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads
  where id = p_thread_id and staff_author_id = p_staff_id and topic = 'staff';
  if v_thread.id is null then
    raise exception 'thread_not_found';
  end if;

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
      'status', v_thread.status,
      'created_at', v_thread.created_at,
      'updated_at', v_thread.updated_at,
      'last_message_at', v_thread.last_message_at,
      'unread_for_visitor', v_thread.unread_for_visitor
    ),
    'messages', v_messages
  );
end;
$$;

grant execute on function public.support_staff_self_fetch(uuid, uuid) to anon, authenticated;

create or replace function public.support_staff_self_mark_read(
  p_staff_id uuid,
  p_thread_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_staff_id is null then return; end if;
  update public.support_threads
    set unread_for_visitor = false
  where id = p_thread_id and staff_author_id = p_staff_id and topic = 'staff';
end;
$$;

grant execute on function public.support_staff_self_mark_read(uuid, uuid) to anon, authenticated;

/** Бейдж «есть ответ от техподдержки» в сайдбаре для любого сотрудника. */
create or replace function public.support_staff_self_unread_count(p_staff_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if p_staff_id is null then return 0; end if;
  select count(*)::int into v_count
  from public.support_threads
  where staff_author_id = p_staff_id
    and topic = 'staff'
    and unread_for_visitor = true
    and status != 'closed';
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.support_staff_self_unread_count(uuid) to anon, authenticated;

-- ------------------------------------------------------------------
-- Проверка:
--   select public.support_staff_self_open('<staff-id>', 'Тест: кнопка "закрыть" не работает на страницe /admin/support');
--   select public.support_staff_self_list('<staff-id>');
--   select public.support_staff_list_threads('<admin-id>', null, 'staff', 20);
-- ------------------------------------------------------------------
