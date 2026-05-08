-- 063_support_archive_threads.sql
--
-- Adds a real archive for support chats:
-- - archived chats are hidden from main support queue;
-- - they can be fetched explicitly as archive;
-- - archive/unarchive actions are logged to activity_log.

set search_path = public, pg_temp;

alter table public.support_threads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_staff_id uuid references public.staff(id) on delete set null;

create index if not exists support_threads_archived_idx
  on public.support_threads (archived_at desc)
  where archived_at is not null;

comment on column public.support_threads.archived_at is
  'When not null, thread is moved out of main support queue into archive.';
comment on column public.support_threads.archived_by_staff_id is
  'Staff member who moved thread to archive.';

drop function if exists public.support_staff_list_threads(uuid, text, text, int);
create or replace function public.support_staff_list_threads(
  p_staff_id uuid,
  p_status_filter text default null,
  p_topic_filter text default null,
  p_limit int default 100,
  p_include_archived boolean default false
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
           t.archived_at,
           t.archived_by_staff_id,
           sar.name as archived_by_staff_name,
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
    left join public.staff sar on sar.id = t.archived_by_staff_id
    where t.topic = any(v_allowed)
      and (p_status_filter is null or p_status_filter = '' or t.status = p_status_filter)
      and (
        (coalesce(p_include_archived, false) and t.archived_at is not null)
        or
        (not coalesce(p_include_archived, false) and t.archived_at is null)
      )
    order by t.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;

  return v_result;
end;
$$;

grant execute on function public.support_staff_list_threads(uuid, text, text, int, boolean)
  to anon, authenticated;

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
  where topic = any(v_allowed)
    and archived_at is null;

  select avg(first_reply.first_at - t.created_at)
  into v_avg_first_response
  from public.support_threads t
  join lateral (
    select min(m.created_at) as first_at
    from public.support_messages m
    where m.thread_id = t.id and m.sender_type = 'staff'
  ) first_reply on true
  where t.topic = any(v_allowed)
    and t.archived_at is null
    and t.created_at > now() - interval '30 days'
    and first_reply.first_at is not null;

  select
    count(*) filter (where status = 'closed' and updated_at > now() - interval '24 hours'),
    count(*) filter (where status = 'closed' and updated_at > now() - interval '7 days')
  into v_closed_24h, v_closed_7d
  from public.support_threads
  where topic = any(v_allowed)
    and archived_at is null;

  select count(*) into v_suspicious
  from public.support_threads t
  where t.topic = any(v_allowed)
    and t.archived_at is null
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

create or replace function public.support_staff_archive_thread(
  p_staff_id uuid,
  p_thread_id uuid,
  p_archive boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx record;
  v_thread public.support_threads%rowtype;
  v_do_archive boolean := coalesce(p_archive, true);
begin
  select * into v_ctx from public._support_staff_context(p_staff_id) limit 1;
  if v_ctx.staff_id is null then raise exception 'access_denied'; end if;
  if not (v_ctx.is_admin or v_ctx.is_manager) then raise exception 'access_denied'; end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if v_thread.id is null then raise exception 'thread_not_found'; end if;
  if v_thread.topic in ('site', 'staff') and not v_ctx.is_admin then
    raise exception 'access_denied';
  end if;

  if v_do_archive then
    update public.support_threads
      set archived_at = now(),
          archived_by_staff_id = p_staff_id,
          assigned_staff_id = null,
          assigned_at = null,
          assigned_by_staff_id = null,
          unread_for_staff = false,
          status = 'closed'
    where id = p_thread_id;

    perform public._log_activity(
      'staff',
      p_staff_id,
      null,
      'support.thread.archived',
      'support_thread',
      p_thread_id::text,
      jsonb_build_object('topic', v_thread.topic, 'status_before', v_thread.status)
    );
  else
    update public.support_threads
      set archived_at = null,
          archived_by_staff_id = null
    where id = p_thread_id;

    perform public._log_activity(
      'staff',
      p_staff_id,
      null,
      'support.thread.unarchived',
      'support_thread',
      p_thread_id::text,
      jsonb_build_object('topic', v_thread.topic, 'status_before', v_thread.status)
    );
  end if;

  return jsonb_build_object('ok', true, 'archived', v_do_archive);
end;
$$;

grant execute on function public.support_staff_archive_thread(uuid, uuid, boolean)
  to anon, authenticated;
