-- 026_verify_staff_phone_restore_json.sql
-- На production-проекте функция public.verify_staff_phone была переопределена
-- на returns boolean (видимо, ручным хотфиксом). Логин CRM при этом ломается:
-- AuthContext.parseStaffFromRpcData трактует true/false как «доступ запрещён»
-- и ждёт JSON-строку сотрудника.
--
-- Восстанавливаем контракт из миграции 007: returns json, нормализованное
-- сравнение телефона (только цифры), фильтр is_active.
--
-- Идемпотентно: drop + create or replace.

drop function if exists public.verify_staff_phone(text);

create or replace function public.verify_staff_phone(phone_input text)
returns json
language plpgsql
security definer
set search_path = public
as $fn$
declare
  norm text;
  row_json json;
begin
  norm := regexp_replace(coalesce(phone_input, ''), '\D', '', 'g');
  if norm = '' then
    return null;
  end if;
  select to_json(s.*) into row_json
  from public.staff s
  where regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = norm
    and s.is_active = true
  limit 1;
  return row_json;
end;
$fn$;

revoke all on function public.verify_staff_phone(text) from public;
grant execute on function public.verify_staff_phone(text) to anon, authenticated, service_role;

comment on function public.verify_staff_phone(text) is
  'CRM phone-based login: returns the matching active staff row as JSON or null. Frontend treats non-object results (null/true/false) as access denied.';
