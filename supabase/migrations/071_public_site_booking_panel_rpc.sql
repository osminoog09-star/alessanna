-- Чтение флага публичной записи для anon без расширения SELECT по всей salon_settings.
-- Решает случай: ключ есть в БД, но RLS ещё не обновлён (070) или клиент не видит строку.

set search_path = public;

create or replace function public.public_site_booking_panel_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  select s.value into v
  from public.salon_settings s
  where s.key = 'public_booking_panel_enabled';

  if v is null then
    return true;
  end if;

  v := lower(trim(both from v));
  if v in ('false', '0', 'no', 'off') then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.public_site_booking_panel_enabled() is
  'Публичная панель записи включена (true по умолчанию). Обход RLS для anon/сайта.';

revoke all on function public.public_site_booking_panel_enabled() from public;
grant execute on function public.public_site_booking_panel_enabled() to anon, authenticated;
