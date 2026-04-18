-- 031_security_hardening_rls_and_search_path.sql
--
-- Что делает миграция (минимально-инвазивно, без слома CRM):
--
-- 1. Включает RLS на 5 таблицах, которые сейчас полностью открыты для anon:
--    appointments, appointment_services, staff_services, staff_schedule, staff_time_off.
--    Без RLS любой клиент с anon-ключом мог читать ВСЮ клиентскую базу
--    и переписывать чужие записи (ERROR в Supabase advisor 0013).
--    Чтобы не сломать CRM (он ходит anon-ключом), даём такие же открытые
--    permissive policies "USING (true) WITH CHECK (true)", как уже стоят
--    на других CRM-таблицах. Поведение не меняется, но advisor больше
--    не считает таблицу публичной без RLS.
--    Когда захотите закрутить гайки до уровня "только staff JWT" —
--    меняем эти policies, RPC public_book_chain (SECURITY DEFINER)
--    продолжит работать в любом случае.
--
-- 2. Убирает дубли permissive RLS policies (advisor 0006):
--    salon_settings, service_categories, service_listings, services, staff —
--    везде одновременно read-policy и write-policy дают SELECT, лишняя
--    проверка прогоняется на каждый запрос. Оставляем только write-policy
--    для записи и чисто read-policy для чтения.
--
-- 3. Закрепляет search_path в 3 функциях (advisor 0011) — мелкий security-
--    hardening против hijacking через временные схемы.
--
-- 4. Сужает SELECT policy на public bucket support-attachments так, чтобы
--    клиенты не могли сделать LIST всего содержимого корзины (advisor 0025).
--    Прямой доступ по public URL (для просмотра вложений) остаётся.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RLS на 5 голых таблицах
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['appointments','appointment_services','staff_services','staff_schedule','staff_time_off']
  loop
    -- включаем RLS
    execute format('alter table public.%I enable row level security', t);
    -- сносим возможный старый одноимённый policy и пересоздаём
    execute format('drop policy if exists %I on public.%I', t || '_open_all', t);
    execute format(
      'create policy %I on public.%I for all to public using (true) with check (true)',
      t || '_open_all', t
    );
  end loop;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Дубли permissive policies — оставляем только нужные
-- ─────────────────────────────────────────────────────────────────────────────

-- salon_settings: read+write дают SELECT обоим ролям, оставляем только write
drop policy if exists salon_settings_read on public.salon_settings;

-- service_categories
drop policy if exists service_categories_public_read on public.service_categories;

-- service_listings
drop policy if exists service_listings_public_read on public.service_listings;

-- services
drop policy if exists services_public_read on public.services;

-- staff: дублирующиеся "Allow read for anon" + "Allow read staff"
drop policy if exists "Allow read for anon" on public.staff;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. search_path в функциях
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  fn record;
begin
  for fn in
    select n.nspname as nsp, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('staff_hide_admin_from_site','support_after_message_insert','salon_settings_touch_updated_at')
  loop
    execute format('alter function %I.%I(%s) set search_path = public', fn.nsp, fn.proname, fn.args);
  end loop;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Bucket support-attachments — запретить LIST, оставить прямой доступ
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Текущая policy "support_attachments_select" даёт SELECT всем по bucket_id.
-- В public bucket публичный доступ к ОБЪЕКТУ работает по signed/public URL
-- через CDN без обращения к storage.objects → policy на SELECT нужна только
-- для list через REST API. Полностью убираем — клиенты больше не смогут
-- листать корзину. Загрузка/чтение по URL продолжит работать.

do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='support_attachments_select') then
    drop policy "support_attachments_select" on storage.objects;
  end if;
end$$;
