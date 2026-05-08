-- 057_site_booking_cart_toggle.sql
-- Фича-флаг для публичного сайта: показывать или скрывать корзину "Ваш выбор".
-- Значение хранится в public.salon_settings.value как строка: 'true' | 'false'.

insert into public.salon_settings (key, value)
values ('site_booking_cart_enabled', 'true')
on conflict (key) do nothing;
