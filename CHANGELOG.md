# Changelog — Alessanna platform

> Двуязычные патчноуты: что и зачем поменялось, плюс хэш коммита для ссылки.
> Bilingual patch notes: what changed, why, with a commit hash.
>
> Формат вдохновлён [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
> Версионирование пока «по релизным дням», SemVer прикрутим вместе с `package.json`.

---

## [Unreleased]

Здесь копится то, что уже в `main`, но ещё не получило версионную «коробку».
What is in `main` but not yet boxed into a release.

---

## 2026-04-19 — «Type debt cleanup + DnD services» / «Закрытие TS-долга + DnD услуг»

### Russian

**Добавлено**
- `AdminStaffPage`: drag-and-drop услуг между секциями **Активные / Неактивные** для конкретного мастера. DnD внутри секции по-прежнему сортирует категории. (`0ed84c5`)
- Двуязычные `FAQ.md`, `CHANGELOG.md`, `ROADMAP.md`. (текущий релиз)

**Исправлено**
- 12+ ошибок `tsc --noEmit` после миграций: `SiteBlockType`/`SitePageRow` приведены к реальному CHECK миграции 017, фолбэк-цепочки `select(...)` теперь типобезопасны через `as typeof`, `serviceId` стал `string | number` в `BookingModal`, `CalendarPage`, `ProCalendar`. (`0ed84c5`)
- Миграция `033_crm_legacy_columns.sql`: `categories.id` теперь `bigint identity` (как ждёт FK из `002`), а не UUID — больше нет тихого расхождения схем. (`1b535e0`)
- Лендинг строго фильтрует мастеров по `staff_services` — нет «молчаливого fallback на всех», когда CRM никому не выдал доступ. (`e4aa7db`)
- `site-builder.mjs`: fetch `site_blocks` обёрнут в `try/catch` + `void main().catch(...)`, нет больше unhandled rejections. (`e4aa7db`)

**Изменено**
- Виджет техподдержки (`site-support-chat.mjs`): редизайн панели и лаунчера — многослойный gold-фон, gold-glow тени, backdrop-filter, decorative top-line. На мобильных `backdrop-filter` отключен (perf). (`ca412f0`)

### English

**Added**
- `AdminStaffPage`: drag-and-drop of service categories between **Active / Inactive** sections per master. DnD within a section still reorders categories. (`0ed84c5`)
- Bilingual `FAQ.md`, `CHANGELOG.md`, `ROADMAP.md`. (this release)

**Fixed**
- 12+ `tsc --noEmit` errors after schema migrations: `SiteBlockType`/`SitePageRow` aligned with the real CHECK in migration 017, `select(...)` fallback chains made type-safe via `as typeof`, `serviceId` widened to `string | number` in `BookingModal`, `CalendarPage`, `ProCalendar`. (`0ed84c5`)
- Migration `033_crm_legacy_columns.sql`: `categories.id` is now `bigint identity` (as the FK from `002` expects), no longer a silent UUID mismatch. (`1b535e0`)
- Landing strictly filters masters by `staff_services` — no more silent "fall back to all masters" when CRM gave no one access. (`e4aa7db`)
- `site-builder.mjs`: `site_blocks` fetch wrapped in `try/catch` + `void main().catch(...)`, no more unhandled rejections. (`e4aa7db`)

**Changed**
- Support chat widget (`site-support-chat.mjs`): panel + launcher redesigned — multi-layer gold background, gold-glow shadows, `backdrop-filter`, decorative top accent line. Mobile disables `backdrop-filter` for performance. (`ca412f0`)

---

## 2026-04-18 — «Pre-release simulation pass» / «Прогон полной симуляции»

### Russian

**Добавлено**
- `services.price_cents`/`duration_min`/`buffer_after_min` для AnalyticsPage. (`4cd23e4`)
- Legacy-колонки/таблицы, которые ждёт CRM (закрыло **100+** 4xx за сессию). (`1f70123`)
- SEO-meta + idempotent storage `support-attachments`. (`3417a43`)

**Исправлено**
- Критические баги, найденные полной pre-release симуляцией. (`e2c1bf4`)
- Чат техподдержки: нижний reply-футер скрывается, пока показывается стартовая форма. (`4a29334`)
- AdminStaffPage: «копировать услуги от другого мастера», явный success-feedback на сохранении, варнинг при 0 услуг. (`e9fd389`)

**Изменено**
- RLS-харднинг: устранены 5 ERROR в Supabase Security Advisor, RPC снова работают из anon. (`08db765`)

### English

**Added**
- `services.price_cents`/`duration_min`/`buffer_after_min` for AnalyticsPage. (`4cd23e4`)
- Legacy columns/tables the CRM expects (killed **100+** 4xx per session). (`1f70123`)
- SEO meta tags + idempotent `support-attachments` storage bucket. (`3417a43`)

**Fixed**
- Critical bugs found by the full pre-release simulation. (`e2c1bf4`)
- Support chat: bottom reply footer is hidden while the start form is visible. (`4a29334`)
- AdminStaffPage: "copy services from another master", explicit save success feedback, warning at 0 services. (`e9fd389`)

**Changed**
- RLS hardening: 5 Security Advisor ERRORs cleared, RPCs work from `anon` again. (`08db765`)

---

## 2026-04-17 — «Chain booking + dual-topic support chat» / «Цепочка записей + двойной чат»

### Russian

**Добавлено**
- Цепочка из нескольких услуг к разным мастерам в одной записи (RPC + UI на лендинге и в CRM). (`f77a9e1`, `68ba501`, `7833b95`)
- Двойной чат техподдержки: «гость» и «сотрудник» отдельными топиками, на сайте + в CRM, через Supabase. (`9729d1f`)
- В CRM: `MyHelpPage`, новый layout, отдельный блок «техкоманда» в списке мастеров. (`68ba501`, `c3ef7ac`)
- Пер-сервисный мастер и длительность в карточке корзины + chain-preview в форме. (`7833b95`)
- На лендинге: фильтрация мастеров по выбранной категории и фикс «клик по мастеру синхронизирует категорию формы». (`0dfbc48`, `f77a9e1`)
- Календарный e-mail (salon + staff) + дубль-фиксы по `verify_staff_phone`. (`68ba501`)

**Изменено**
- В `Услугах` мастера показываются как read-only зелёные «чипы». (`b0d70f7`)
- Footer лендинга: подпись авторов в two-language baseline-стрипе с serif italic. (`8893982`, `09b6c65`, `0fa3601`, `5eea04f`, `abbf161`)
- В админке услуг: тогл «На сайте» заменён на derived-бэйдж «доступен/не доступен». (`41d1100`)
- Услуги в анкете мастера разделены на «Активные» / «Неактивные» + DnD-сортировка категорий. (`3699e3c`)

**Исправлено**
- Корзина теперь содержит только мастеров, реально привязанных к выбранной услуге. (`aa5aee3`)
- AdminStaffPage больше не падает, если у мастера ноль связок `staff_services`. (`db34dbd`)
- Кнопки шапки лендинга подняты над drawer-меню. (`c996c56`)
- `site-support-chat.mjs` теперь действительно деплоится в GitHub Pages. (`ba450b9`)

### English

**Added**
- Chain of multiple services with different masters in a single booking (RPC + landing UI + CRM UI). (`f77a9e1`, `68ba501`, `7833b95`)
- Dual support chat: separate topics for "visitor" and "staff", on the site + inside the CRM, via Supabase. (`9729d1f`)
- In the CRM: `MyHelpPage`, new layout, dedicated "tech-team" block in staff list. (`68ba501`, `c3ef7ac`)
- Per-service master and duration in the cart card + chain-preview in the form. (`7833b95`)
- On the landing: master dropdown filtered by chosen category, and "clicking a master syncs the form category". (`0dfbc48`, `f77a9e1`)
- Calendar e-mail (salon + staff) + assorted `verify_staff_phone` fixes. (`68ba501`)

**Changed**
- In `Services` masters are shown as read-only green chips. (`b0d70f7`)
- Landing footer: author credits in a two-language baseline strip with serif italic. (`8893982`, `09b6c65`, `0fa3601`, `5eea04f`, `abbf161`)
- In services admin: "On site" toggle replaced with a derived "available/unavailable" badge. (`41d1100`)
- Master profile services split into "Active" / "Inactive" + DnD reorder for categories. (`3699e3c`)

**Fixed**
- Cart now lists only the masters actually bound to the picked service. (`aa5aee3`)
- AdminStaffPage no longer crashes when a master has zero `staff_services` rows. (`db34dbd`)
- Landing header buttons lifted above the drawer menu. (`c996c56`)
- `site-support-chat.mjs` is now actually shipped to GitHub Pages. (`ba450b9`)

---

## Старые релизы / Earlier releases

Полная история — `git log --oneline`.
Full history — `git log --oneline`.
