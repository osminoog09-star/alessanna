-- 023_support_chat.sql
-- Чат техподдержки/обращений в салон.
--
-- Две темы:
--   * 'salon' — вопросы в салон: видят менеджеры + админы.
--   * 'site'  — техподдержка сайта: видят только админы.
--
-- Посетитель анонимен (только имя обязательно, email опционален), его доступ
-- ограничен `visitor_session_token` (хранится в localStorage). Вся работа
-- посетителя — только через SECURITY DEFINER RPC. Таблицы закрыты RLS.
--
-- Staff тоже ходит через RPC: клиент передаёт `p_staff_id`, RPC проверяет
-- роль и тему, и возвращает только то, что разрешено.
--
-- Схема приложения этого проекта: фронтенд использует anon key без
-- настоящей Supabase-auth (так же, как другие таблицы CRM). Вместо RLS
-- по `auth.uid()` мы централизуем проверки в RPC + RLS запрещает прямой
-- доступ к таблицам.

-- ---------- Таблицы ----------
create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  topic text not null default 'salon' check (topic in ('salon','site')),
  status text not null default 'open' check (status in ('open','pending','closed')),
  visitor_name text not null,
  visitor_email text,
  visitor_session_token text not null unique,
  visitor_user_agent text,
  visitor_origin_url text,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_type text check (last_sender_type in ('visitor','staff','system')),
  unread_for_staff boolean not null default true,
  unread_for_visitor boolean not null default false,
  assigned_staff_id uuid references public.staff(id) on delete set null
);

create index if not exists support_threads_status_updated_idx
  on public.support_threads (status, updated_at desc);
create index if not exists support_threads_topic_updated_idx
  on public.support_threads (topic, updated_at desc);
create index if not exists support_threads_session_idx
  on public.support_threads (visitor_session_token);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  sender_type text not null check (sender_type in ('visitor','staff','system')),
  sender_staff_id uuid references public.staff(id) on delete set null,
  body text not null default '',
  attachment_url text,
  attachment_name text,
  attachment_mime text,
  attachment_size_bytes int
);

create index if not exists support_messages_thread_created_idx
  on public.support_messages (thread_id, created_at);

-- ---------- Триггер: обновляет thread при новом сообщении ----------
create or replace function public.support_after_message_insert()
returns trigger
language plpgsql
as $$
begin
  update public.support_threads
  set updated_at = new.created_at,
      last_message_at = new.created_at,
      last_message_preview = left(coalesce(new.body, ''), 200),
      last_sender_type = new.sender_type,
      unread_for_staff = case
        when new.sender_type = 'visitor' then true
        else unread_for_staff
      end,
      unread_for_visitor = case
        when new.sender_type = 'staff' then true
        else unread_for_visitor
      end,
      -- если посетитель пишет в закрытый тред — автоматически открываем
      status = case
        when status = 'closed' and new.sender_type = 'visitor' then 'open'
        else status
      end
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_support_after_message_insert on public.support_messages;
create trigger trg_support_after_message_insert
  after insert on public.support_messages
  for each row execute function public.support_after_message_insert();

-- ---------- RLS ----------
-- Таблицы закрыты: прямой доступ ни для anon, ни для authenticated.
-- Всё идёт через SECURITY DEFINER RPC ниже.
alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "support_threads_no_direct" on public.support_threads;
drop policy if exists "support_messages_no_direct" on public.support_messages;

-- ---------- Вспомогательная функция для staff ----------
create or replace function public._support_staff_context(p_staff_id uuid)
returns table (
  staff_id uuid,
  staff_name text,
  is_admin boolean,
  is_manager boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select s.id,
         s.name,
         (s.role = 'admin' or s.role = 'owner'
          or 'admin' = any(coalesce(s.roles, array[]::text[]))
          or 'owner' = any(coalesce(s.roles, array[]::text[]))) as is_admin,
         (s.role = 'manager'
          or 'manager' = any(coalesce(s.roles, array[]::text[]))) as is_manager
  from public.staff s
  where s.id = p_staff_id
    and s.is_active = true;
end;
$$;

revoke all on function public._support_staff_context(uuid) from public;

-- ---------- RPC для посетителя ----------

-- Создание треда + первое сообщение (идемпотентно по session_token).
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

  select id into v_thread_id
    from public.support_threads
    where visitor_session_token = p_session_token;

  if v_thread_id is null then
    insert into public.support_threads (
      topic, visitor_name, visitor_email, visitor_session_token,
      visitor_user_agent, visitor_origin_url
    )
    values (
      v_topic, v_name, v_email, p_session_token,
      left(coalesce(p_user_agent, ''), 500),
      left(coalesce(p_origin_url, ''), 500)
    )
    returning id into v_thread_id;
  else
    update public.support_threads
    set visitor_name = v_name,
        visitor_email = coalesce(v_email, visitor_email),
        topic = v_topic
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

-- Добавить сообщение в существующий тред.
create or replace function public.support_visitor_post_message(
  p_session_token text,
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
  v_thread_id uuid;
  v_body text;
begin
  if p_session_token is null or char_length(p_session_token) < 16 then
    raise exception 'invalid_session_token';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' and p_attachment_url is null then
    raise exception 'invalid_body';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'body_too_long';
  end if;

  select id into v_thread_id
    from public.support_threads
    where visitor_session_token = p_session_token;

  if v_thread_id is null then
    raise exception 'thread_not_found';
  end if;

  insert into public.support_messages (
    thread_id, sender_type, body,
    attachment_url, attachment_name, attachment_mime, attachment_size_bytes
  )
  values (
    v_thread_id, 'visitor', v_body,
    p_attachment_url, p_attachment_name, p_attachment_mime, p_attachment_size_bytes
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.support_visitor_post_message(
  text, text, text, text, text, int
) to anon, authenticated;

-- Получить тред + все сообщения (или только новые после p_since_iso).
create or replace function public.support_visitor_fetch(
  p_session_token text,
  p_since_iso timestamptz default null
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
  if p_session_token is null or char_length(p_session_token) < 16 then
    raise exception 'invalid_session_token';
  end if;

  select * into v_thread
    from public.support_threads
    where visitor_session_token = p_session_token;

  if v_thread.id is null then
    return jsonb_build_object('thread', null, 'messages', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(row_to_json(m) order by m.created_at asc), '[]'::jsonb)
  into v_messages
  from (
    select m.id, m.created_at, m.sender_type, m.body,
           m.attachment_url, m.attachment_name, m.attachment_mime, m.attachment_size_bytes
    from public.support_messages m
    where m.thread_id = v_thread.id
      and (p_since_iso is null or m.created_at > p_since_iso)
    order by m.created_at asc
  ) m;

  return jsonb_build_object(
    'thread', jsonb_build_object(
      'id', v_thread.id,
      'topic', v_thread.topic,
      'status', v_thread.status,
      'visitor_name', v_thread.visitor_name,
      'visitor_email', v_thread.visitor_email,
      'last_message_at', v_thread.last_message_at,
      'unread_for_visitor', v_thread.unread_for_visitor
    ),
    'messages', v_messages
  );
end;
$$;

grant execute on function public.support_visitor_fetch(text, timestamptz) to anon, authenticated;

-- Сбросить unread у посетителя (когда он открыл свою переписку).
create or replace function public.support_visitor_mark_read(p_session_token text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_session_token is null or char_length(p_session_token) < 16 then
    return;
  end if;
  update public.support_threads
  set unread_for_visitor = false
  where visitor_session_token = p_session_token;
end;
$$;

grant execute on function public.support_visitor_mark_read(text) to anon, authenticated;

-- ---------- RPC для staff ----------

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
    v_allowed := array['salon','site'];
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
           t.unread_for_staff, t.assigned_staff_id
    from public.support_threads t
    where t.topic = any(v_allowed)
      and (p_status_filter is null or p_status_filter = '' or t.status = p_status_filter)
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return v_result;
end;
$$;

grant execute on function public.support_staff_list_threads(uuid, text, text, int) to anon, authenticated;

-- Счётчик непрочитанных — для бейджа в сайдбаре.
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
    v_allowed := array['salon','site'];
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

grant execute on function public.support_staff_unread_count(uuid) to anon, authenticated;

-- Сообщения треда.
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
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;

  if v_thread.topic = 'site' and not v_ctx.is_admin then
    raise exception 'access_denied';
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
      'assigned_staff_id', v_thread.assigned_staff_id
    ),
    'messages', v_messages
  );
end;
$$;

grant execute on function public.support_staff_fetch_messages(uuid, uuid) to anon, authenticated;

-- Ответ от staff.
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
  if v_thread.topic = 'site' and not v_ctx.is_admin then
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

grant execute on function public.support_staff_post_message(
  uuid, uuid, text, text, text, text, int
) to anon, authenticated;

-- Смена статуса / назначение / сброс непрочитанного.
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
  if v_thread.topic = 'site' and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  if p_status is not null and p_status != '' then
    if p_status not in ('open','pending','closed') then
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

grant execute on function public.support_staff_update_thread(
  uuid, uuid, text, uuid, boolean
) to anon, authenticated;

-- ---------- Storage bucket для вложений (фаза 3) ----------
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', true)
on conflict (id) do nothing;

-- Разрешить anon + authenticated загружать файлы в этот бакет.
-- Объекты публично читаемы (public=true). Путь вида
-- {visitor_session_token}/{uuid}.{ext} — безопасно, т.к. токен секретный
-- и известен только самому посетителю.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_insert'
  ) then
    create policy "support_attachments_insert"
      on storage.objects for insert
      to anon, authenticated
      with check (bucket_id = 'support-attachments');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'support_attachments_select'
  ) then
    create policy "support_attachments_select"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'support-attachments');
  end if;
end $$;

-- ---------- Realtime publication (для будущих фаз) ----------
-- Сейчас CRM опрашивает RPC каждые несколько секунд (проще и устойчивее
-- без настоящей auth). Добавим таблицы в publication заранее — это не
-- нарушает RLS (клиент всё равно получит ровно то, что разрешает политика).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_threads'
  ) then
    execute 'alter publication supabase_realtime add table public.support_threads';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.support_messages';
  end if;
end $$;

-- ---------- Проверка ----------
-- select support_staff_unread_count(<staff_id>) должен работать и возвращать 0.
-- Посетитель:
--   select support_visitor_start_thread('test-session-token-longer-than-16', 'site', 'Денис', 'denis@example.com', 'Привет!');
--   select support_visitor_fetch('test-session-token-longer-than-16');
-- Staff (Денис — admin):
--   select support_staff_list_threads('<denis-staff-id>', null, null, 50);
