-- 029_verify_staff_phone_normalize_country.sql
--
-- Bugfix: на проде админы и менеджеры не могли войти, если вводили телефон
-- с международным префиксом (например, "+372 5837 6243"), хотя в базе номер
-- сохранён без +372 ("58376243"). Прежняя миграция 026 нормализовала только
-- "цифры", и +37258376243 != 58376243.
--
-- Новый алгоритм:
--   1) выдираем только цифры из ввода и из staff.phone;
--   2) совпадение, если:
--      a) полное равенство цифр (старое поведение, для коротких внутренних
--         номеров и одинакового формата);
--      b) ИЛИ хвост из 7 цифр совпадает у обоих (это национальная часть
--         для всех соседних стран: EE/LV/LT/FI/RU и т.п. имеют ≥7 цифр).
--
-- Идемпотентно: drop + create.

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
  where s.is_active = true
    and (
      regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = norm
      or (
        length(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g')) >= 7
        and length(norm) >= 7
        and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 7) = right(norm, 7)
      )
    )
  order by
    /* приоритет точному совпадению, чтобы коллизии хвоста (если когда-нибудь
       заведут двух сотрудников с одинаковыми последними 7 цифрами) не
       выбирали случайного. */
    case when regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') = norm then 0 else 1 end,
    s.created_at
  limit 1;

  return row_json;
end;
$fn$;

revoke all on function public.verify_staff_phone(text) from public;
grant execute on function public.verify_staff_phone(text) to anon, authenticated, service_role;

comment on function public.verify_staff_phone(text) is
  'CRM phone-based login: returns the matching active staff row as JSON or null. Matches by full digit equality OR by trailing 7 digits (handles +372 / spaces / dashes).';
