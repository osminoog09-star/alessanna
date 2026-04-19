-- 045_mark_legacy_services_deprecated.sql
-- ============================================================================
-- P3: пометка legacy public.services как DEPRECATED.
--
-- Контекст:
--   * Истинный каталог услуг живёт в public.service_listings (UUID PK).
--   * Старая таблица public.services осталась как fallback, чтобы старые
--     версии CRM/виджетов продолжали показывать каталог. См.
--     work/src/lib/loadServicesCatalog.ts — там описан fallback.
--
-- Что делает этот миграционный шаг:
--   * Просто навешивает COMMENT, чтобы любой DB-tool (Supabase, dbeaver) сразу
--     видел: «не пишите сюда, это legacy».
--
-- Когда удалять:
--   * После релиза, в котором loadServicesCatalog перестанет читать `services`
--     даже как fallback (и спустя >= 1 спринт без жалоб).
-- ============================================================================

comment on table public.services is
  'DEPRECATED 2026-04-20: историческая таблица услуг. Новые релизы используют public.service_listings. Не удалять до полной миграции fallback-логики во фронте.';
