# Roadmap — Alessanna platform

> Что мы планируем дальше. Двуязычно (RU/EN). Каждая позиция помечена приоритетом:
> `[P0]` критично, `[P1]` важно, `[P2]` хорошо бы, `[P3]` идея.
>
> What we plan next. Bilingual (RU/EN). Each item is tagged with a priority:
> `[P0]` critical, `[P1]` important, `[P2]` nice to have, `[P3]` idea.

---

## Now (в работе) / In progress

### Russian

- `[P0]` — Bucket `support-attachments` в Supabase Storage с RLS (если ещё не создан вручную).
- `[P0]` — Сверить i18n-паритет: ключи в `locales/ru.json` vs `et.json` vs `en.json` — вытащить недостающие строки.
- `[P1]` — Добить chunk-size warning у Vite (`manualChunks` для `react`, `supabase`, `dnd-kit`) — сейчас 681 KB / 196 KB gz одним чанком.
- `[P1]` — Дубль номера миграции `016_*` — пройтись и убедиться, что обе идемпотентны (или переименовать одну в `016a/016b`).

### English

- `[P0]` — Create Supabase Storage bucket `support-attachments` with RLS (if not done manually).
- `[P0]` — Verify i18n parity: `locales/ru.json` vs `et.json` vs `en.json` — fill in missing keys.
- `[P1]` — Resolve Vite chunk-size warning (`manualChunks` for `react`, `supabase`, `dnd-kit`) — currently 681 KB / 196 KB gz in a single chunk.
- `[P1]` — Duplicate migration number `016_*` — confirm both are idempotent (or rename one to `016a/016b`).

---

## Next (следующий спринт) / Next sprint

### Russian

- `[P1]` — **Reschedule UI**: API уже умеет `PATCH` с новой датой/временем/мастером/услугой — дорисовать модалку «перенести запись» в CRM.
- `[P1]` — **User admin UI**: создание логинов под мастера прямо из CRM (сейчас через DB/RPC).
- `[P1]` — **SiteBuilder Phase 2**: вернуть «маркетинговые» блоки (`hero`, `cta`, `team`, `services`, `reviews`, `contacts`) — сейчас тип сжат до 5 реальных DB-типов; нужно расширить CHECK + добавить рендереры.
- `[P2]` — **SEO/брендинг** на `index.html`: favicon, canonical-link, og:image, Schema.org `LocalBusiness`.
- `[P2]` — Перевести CRM на эстонский (сейчас RU + EN).

### English

- `[P1]` — **Reschedule UI**: the API already supports `PATCH` with new date/time/master/service — draw the "move booking" modal in the CRM.
- `[P1]` — **User admin UI**: create per-master logins from inside the CRM (today done via DB/RPC).
- `[P1]` — **SiteBuilder Phase 2**: bring back "marketing" blocks (`hero`, `cta`, `team`, `services`, `reviews`, `contacts`) — the type is currently shrunk to 5 real DB types; need to widen the CHECK + add renderers.
- `[P2]` — **SEO/branding** on `index.html`: favicon, canonical link, og:image, Schema.org `LocalBusiness`.
- `[P2]` — Estonian translation in the CRM (today: RU + EN).

---

## Later (позже) / Later

### Russian

- `[P2]` — **Google OAuth + Calendar push**: двухсторонняя синхронизация записей с Google Календарём салона и личных мастеров.
- `[P2]` — **Telegram / WhatsApp send** на события записи (создана / напоминание за 24 ч / отменена).
- `[P3]` — **Платежи**: Stripe / Bolt / Pocopay — предоплата за слот.
- `[P3]` — **Loyalty / Подарочные сертификаты** (новые таблицы + UI в CRM).
- `[P3]` — **Mobile app** (React Native / Expo) — общий клиент для записи + push.
- `[P3]` — **Аналитика для владельца**: дашборд с retention, средним чеком, no-show rate, выручкой по мастерам.

### English

- `[P2]` — **Google OAuth + Calendar push**: two-way sync of bookings with the salon's and personal masters' Google Calendars.
- `[P2]` — **Telegram / WhatsApp send** on booking events (created / 24 h reminder / cancelled).
- `[P3]` — **Payments**: Stripe / Bolt / Pocopay — slot prepayment.
- `[P3]` — **Loyalty / gift cards** (new tables + CRM UI).
- `[P3]` — **Mobile app** (React Native / Expo) — single client for booking + push notifications.
- `[P3]` — **Owner analytics**: dashboard with retention, avg ticket, no-show rate, per-master revenue.

---

## Done (что уже выкачено) / Done

Полный список — в [`CHANGELOG.md`](./CHANGELOG.md). Кратко из последнего:

Full list lives in [`CHANGELOG.md`](./CHANGELOG.md). Recent highlights:

- ✅ Цепочка записей к нескольким мастерам в одной брони / Chain booking with multiple masters in one slot.
- ✅ Двойной чат техподдержки (гость + сотрудник) / Dual support chat (visitor + staff).
- ✅ Drag-and-drop услуг между активными/неактивными / DnD services between active/inactive.
- ✅ TS-долг закрыт, `tsc --noEmit` PASS / TS debt cleared, `tsc --noEmit` PASS.
- ✅ RLS-харднинг (5 ERROR в Supabase Security Advisor) / RLS hardening (5 Supabase Security Advisor ERRORs).
- ✅ Редизайн виджета техподдержки под тёмный фон / Support chat widget redesign for dark backgrounds.

---

## Принципы / Principles

### Russian

- **Идемпотентные миграции**: каждый SQL — `if not exists` / `add column if not exists` / `update ... where ... is null`. Никаких разрушающих DDL.
- **Schema-drift safety**: новые компоненты CRM при `select(...)` имеют fallback-цепочку под старые БД (без `buffer_after_min`, без `is_active` и т. д.).
- **TS как gate**: после каждой работы — `tsc --noEmit && vite build`. Без них в `main` мерджа нет.
- **RLS over service-role**: всё что можно — через `anon` под RLS. `service-role` — только в серверных RPC.

### English

- **Idempotent migrations**: every SQL is `if not exists` / `add column if not exists` / `update ... where ... is null`. No destructive DDL.
- **Schema-drift safety**: new CRM components ship with `select(...)` fallback chains for older DBs (no `buffer_after_min`, no `is_active`, etc).
- **TS as a gate**: after every job — `tsc --noEmit && vite build`. Nothing merges into `main` without both green.
- **RLS over service-role**: anything possible — through `anon` under RLS. `service-role` only inside server-side RPCs.
