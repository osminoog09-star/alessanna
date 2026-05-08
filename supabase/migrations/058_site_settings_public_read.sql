-- 058_site_settings_public_read.sql
-- Разрешаем публичному сайту читать ТОЛЬКО флаг видимости корзины.
-- Без этого anon-ключ не может читать public.salon_settings из-за RLS.

drop policy if exists salon_settings_public_site_read on public.salon_settings;

create policy salon_settings_public_site_read
on public.salon_settings
for select
using (key = 'site_booking_cart_enabled');
