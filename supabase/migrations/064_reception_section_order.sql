-- 064_reception_section_order.sql
-- Порядок блоков страницы записи / ресепшена в salon_settings (JSON-массив строк).
-- Публичное чтение anon — как у site_booking_cart_enabled.

set search_path = public;

drop policy if exists salon_settings_public_site_read on public.salon_settings;

create policy salon_settings_public_site_read
on public.salon_settings
for select
using (key in ('site_booking_cart_enabled', 'reception_section_order'));

insert into public.salon_settings (key, value)
values (
  'reception_section_order',
  '["calendar","upcoming","masters","booking"]'
)
on conflict (key) do nothing;
