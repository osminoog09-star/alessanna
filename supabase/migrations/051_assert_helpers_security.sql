-- 051_assert_helpers_security.sql
-- ============================================================================
-- HOTFIX по результатам Cursor BugBot review на 047_salon_devices.sql.
--
-- БАГ: хелперы _staff_assert_admin (047) и _staff_assert_manage (050)
-- объявлены БЕЗ security definer и НЕ revoke-нуты у public. В коде
-- 047 даже стоит комментарий «security definer обходит RLS» — но самой
-- директивы нет. Сейчас прод выживает только потому, что RLS-политика
-- public.staff permissive (using true). Любая будущая попытка ужесточить
-- RLS на staff (например, "видишь только свою строку") тихо поломает ВСЕ
-- админские RPC: SELECT внутри хелпера вернёт 0 строк → admin_required 42501
-- даже для легитимного админа. Вторая мелочь — execute открыт у anon: любой
-- может тыкать «public._staff_assert_admin(uuid)» и получать в ответ
-- exception, что само по себе утечка модели поведения.
--
-- ФИКС: оба хелпера переопределяем как security definer + revoke
-- от public + явный grant только в анонимный/authenticated на чтение
-- (это нужно, потому что admin RPC вызывают их через PERFORM, а владельцы
-- этих RPC — postgres). Логика самого assert не меняется — побайтно та же.
--
-- ПРОВЕРКИ ПЕРЕД ВЫКАТКОЙ:
--   * Все 14+ admin RPC, которые делают `perform _staff_assert_admin(...)`,
--     продолжают работать: security definer наследуется, current_user
--     внутри хелпера всегда совпадает с owner (postgres).
--   * `_staff_assert_manage` используется только staff_manage_list_all_devices
--     (manager+admin read-only). Тот же эффект.
--   * Поведение на «не-админ» не меняется — всё так же 42501 admin_required.
-- ============================================================================

begin;

create or replace function public._staff_assert_admin(actor_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  s public.staff;
  has_admin boolean := false;
begin
  if actor_id is null then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into s from public.staff where id = actor_id and is_active = true;
  if s.id is null then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if lower(coalesce(s.role, '')) = 'admin' then
    has_admin := true;
  end if;
  if not has_admin then
    select true into has_admin
    from unnest(coalesce(s.roles, '{}'::text[])) r
    where lower(r) = 'admin'
    limit 1;
  end if;
  if not coalesce(has_admin, false) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
end;
$$;

-- В Supabase у ролей anon/authenticated есть default-grant на public.* —
-- одного `revoke ... from public` мало, дочищаем явно. Хелпер не должен
-- быть доступен напрямую: его дёргают только security-definer-обёртки
-- (admin/manage RPCs), а они владеют postgres'ом и вызовут хелпер всё равно.
revoke all on function public._staff_assert_admin(uuid) from public, anon, authenticated;

create or replace function public._staff_assert_manage(actor_id uuid)
returns void
language plpgsql
security definer
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

revoke all on function public._staff_assert_manage(uuid) from public, anon, authenticated;

commit;
