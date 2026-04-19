-- 050_manage_list_devices.sql
-- ============================================================================
-- Read-only список ВСЕХ доверенных устройств для менеджеров и админов.
--
-- Раньше staff_admin_list_all_devices был только для admin (через
-- _staff_assert_admin). По UX-фидбэку: менеджер тоже должен видеть полную
-- картину (но без управляющих кнопок claim/release/revoke). Админ — тем
-- более. Мастер (worker) не видит чужие устройства вообще.
--
-- Добавляем хелпер _staff_assert_manage и новый read-only RPC
-- staff_manage_list_all_devices. Сама админская staff_admin_list_all_devices
-- остаётся как есть и продолжает требовать admin для совместимости с UI.
-- ============================================================================

begin;

create or replace function public._staff_assert_manage(actor_id uuid)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s public.staff;
  has_role boolean := false;
begin
  if actor_id is null then
    raise exception 'manage_required' using errcode = '42501';
  end if;
  select * into s from public.staff where id = actor_id and is_active = true;
  if s.id is null then
    raise exception 'manage_required' using errcode = '42501';
  end if;
  if lower(coalesce(s.role, '')) in ('admin', 'manager') then
    has_role := true;
  end if;
  if not has_role then
    select true into has_role
    from unnest(coalesce(s.roles, '{}'::text[])) r
    where lower(r) in ('admin', 'manager')
    limit 1;
  end if;
  if not coalesce(has_role, false) then
    raise exception 'manage_required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.staff_manage_list_all_devices(actor_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._staff_assert_manage(actor_id);
  return query
    select jsonb_build_object(
      'id', td.id,
      'label', td.label,
      'user_agent', td.user_agent,
      'ip_address', host(td.ip_address),
      'created_at', td.created_at,
      'last_seen_at', td.last_seen_at,
      'revoked_at', td.revoked_at,
      'is_salon_device', td.is_salon_device,
      'claimed_at', td.claimed_at,
      'staff_id', td.staff_id,
      'staff_name', s.name,
      'staff_role', s.role,
      'staff_roles', s.roles,
      'staff_is_active', s.is_active,
      'claimed_by_admin_id', td.claimed_by_admin_id,
      'claimed_by_admin_name', a.name
    )
    from public.staff_trusted_devices td
    left join public.staff s on s.id = td.staff_id
    left join public.staff a on a.id = td.claimed_by_admin_id
    order by td.is_salon_device desc, td.revoked_at nulls first, td.last_seen_at desc;
end;
$$;

revoke all on function public.staff_manage_list_all_devices(uuid) from public;
grant execute on function public.staff_manage_list_all_devices(uuid) to anon, authenticated;

commit;
