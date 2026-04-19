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

> Стабильные точки и правила версионирования теперь живут в [`RELEASES.md`](./RELEASES.md).
> Stable points and versioning rules now live in [`RELEASES.md`](./RELEASES.md).

---

## 2026-04-19 (вечер) — «Multi-service master selection fix»

### Russian

**Исправлено (публичный сайт, форма записи)**
- Если в корзине несколько услуг с РАЗНЫМИ мастерами (например, женская стрижка + классический маникюр), select «Мастер» больше не показывает чужих мастеров с серыми `disabled`-опциями и больше не лжёт хинтом «Один мастер на всю цепочку». Теперь поведение единообразное: остаётся только «Не важно» и пояснение «Эти услуги делают разные мастера — выберите по одному в карточках выше». Источник истины — `globalThis.__SITE_BOOKING_CHAIN__.getCommonMasters()` (пересечение по `staff_services` из CRM); внутри `setMasterOptions` стоит «hard rail», который окончательно сводит список dropdown'a к этому пересечению независимо от того, кто его пересобрал (legacy demo, API employees или filterMastersByFormCategory).
- Когда корзина пуста — поведение прежнее (показываем всех публичных мастеров).
- Когда в корзине одна услуга — dropdown содержит только тех мастеров, кому в CRM проставлено право её делать, плюс «Не важно».
- Хинт под select обновляется на 4 состояния: пусто / 1 услуга / 2+ с общим мастером / 2+ без общего; required снимается при ≥1 услуге, потому что мастер задаётся per-service в карточках корзины.
- Цепочка по времени уже работает на сервере: SQL-функция `public_book_chain` (миграция `024_public_book_chain.sql`) сама прибавляет `duration + buffer_after_min` к каждой следующей услуге — клиенту достаточно выбрать день и время начала.
- Локальный smoke (Стрижка → переключение на Маникюр → добавление маникюра): hint менялся 1 услуга → "Один мастер" → "Эти услуги делают разные мастера", в dropdown оставалось только «Не важно», disabled-фантомов нет.

**Стабильная точка**
- `stable-2026-04-19-site-master-multi-service-fix` → (см. `RELEASES.md`)

### English

**Fixed (public site, booking form)**
- When the cart contains multiple services with DIFFERENT eligible masters (e.g. women's haircut + classic manicure), the "Master" select no longer shows ineligible masters as greyed-out `disabled` options, and the hint no longer lies with "One stylist for the whole chain". The behaviour is now consistent: only "No preference" remains, with an explanation "These services are done by different stylists — pick one per card above". Source of truth is `globalThis.__SITE_BOOKING_CHAIN__.getCommonMasters()` (intersection by `staff_services` from CRM); inside `setMasterOptions` there is a hard rail that always reduces the dropdown to that intersection, regardless of who repopulated it (legacy demo, API employees, or filterMastersByFormCategory).
- Empty cart — original behaviour (all public masters are shown).
- One service in cart — dropdown contains only masters granted in CRM, plus "No preference".
- Hint under the select now has 4 states: empty / 1 service / 2+ with a common master / 2+ without; `required` is dropped when ≥1 service is in the cart, because masters are picked per-service in the cart cards.
- Time chaining is already correct on the server: SQL function `public_book_chain` (migration `024_public_book_chain.sql`) advances by `duration + buffer_after_min` for each next service — the client only picks day + start time.
- Local smoke (Haircut → switch to Manicure tab → add manicure): hint went 1 service → "One stylist" → "These services are done by different stylists", dropdown stayed at "No preference" only, no disabled phantoms.

**Stable point**
- `stable-2026-04-19-site-master-multi-service-fix` → (see `RELEASES.md`)

---

## 2026-04-19 (ночь) — «Public site clarity»

### Russian

**Изменено (публичный сайт)**
- Календарь записи: каждая ячейка теперь имеет осмысленный `title` и `aria-label` — «Прошедшая дата», «Выходной», «Нет свободных окон в этот день» или «Доступно: N». Раньше неподходящие даты выглядели одинаково и клиенты подозревали баг сайта. (`8153a4f`)
- В легенду календаря добавлен четвёртый индикатор «Нет окон / выходной» (пунктирный круг) — соответствует серым ячейкам.
- `window.alert(...)` заменён на компактный toast в правом верхнем углу (на мобиле — снизу, выше панели быстрой записи). Применено к подтверждению записи (Supabase RPC и legacy API), к ошибкам сети, к валидации формы отзыва. (`70964b0`)
- Toast: ✓ для успеха, ! для ошибки, авто-исчезает через 5–8 с, есть кнопка «×», `role="status"`/`role="alert"`, поддержка `prefers-reduced-motion`.

**Удалено**
- Дубль кнопки «Записаться» внизу секции «Контакты» — на странице уже есть основная CTA в hero, sticky-кнопка в шапке и mobile-book-bar. Лишняя повторяющаяся кнопка зашумляла финал страницы. (`4f73c5f`)

**Стабильная точка**
- `stable-2026-04-19-public-site-clarity` → `dfaa56c`

### English

**Changed (public site)**
- Booking calendar: every day cell now has a meaningful `title` and `aria-label` — "Past date", "Day off", "No openings this day" or "Available: N". Previously all unavailable dates looked the same and clients suspected a website bug. (`8153a4f`)
- Calendar legend: added the fourth indicator "No openings / day off" (dashed circle) — matches greyed-out cells.
- Replaced `window.alert(...)` with a compact toast in the top-right corner (bottom on mobile, above the quick-book bar). Applied to booking confirmation (Supabase RPC and legacy API), network errors, and review-form validation. (`70964b0`)
- Toast: ✓ for success, ! for error, auto-dismiss after 5–8s, "×" close button, `role="status"`/`role="alert"`, respects `prefers-reduced-motion`.

**Removed**
- Duplicate "Записаться" CTA at the bottom of the Contacts section — the page already has the primary CTA in hero, sticky button in the header, and the mobile-book-bar. (`4f73c5f`)

**Stable point**
- `stable-2026-04-19-public-site-clarity` → `dfaa56c`

---

## 2026-04-19 (поздний вечер) — «CRM UX cleanup + public-site cleanup»

### Russian

**Изменено**
- `BookingsPage`: добавлены поиск (имя/телефон/услуга/мастер/заметка), сегментированный фильтр статуса (по умолчанию «Активные»), счётчик «X из N», empty-state с «Сбросить фильтры», error-state, status-badge с цветом, телефон под именем клиента. (`29752ad`)
- `AdminSupportPage`: два ряда pill-фильтров (4 + 4 = 8 кнопок) свёрнуты в один компактный bar — 3 пилюли «Активные/Все/Закрытые» + dropdown «Тема» для админа. В шапке треда удалён сегмент «Статус: open/pending», заменён одной явной кнопкой «⏸ В ожидание» / «↩ Вернуть в работу» рядом с «✓ Закрыть». (`29752ad`)
- `AdminIntegrationsPage`: длинная секция «Очередь синхронизации» обёрнута в `<details>`, по умолчанию свёрнута, авто-открывается при наличии error/skipped. В summary выведены счётчики ⚠ ошибок / ⏸ пропущено / ⏳ в очереди — видны и в свёрнутом виде. (`29752ad`)
- `Layout` + `CommandPalette`: новый флаг `adminOnly` для NavItem/CommandItem. «Интеграции» теперь admin-only (раньше менеджер видел технический setup). (`29752ad`)

**Удалено (публичный сайт)**
- Декоративный SVG `hero-flourish` рядом с логотипом AlesSanna в hero. (`796b07a`)
- Два параграфа в секции «О салоне» (`Härma Keskus…` и `Волосы, ногти…`). (`796b07a`)

**Стабильные точки**
- `stable-2026-04-19-crm-ux` → `29752ad`
- `stable-2026-04-19-public-site-cleanup` → `796b07a`

### English

**Changed**
- `BookingsPage`: search (name/phone/service/staff/note), segmented status filter (default "Active"), counter, empty/error states, colored status badge, phone under client name. (`29752ad`)
- `AdminSupportPage`: two rows of pill filters (4 + 4 = 8 buttons) collapsed into one compact bar — 3 pills (Active/All/Closed) + Topic dropdown for admin. In thread header, removed the segmented "Status: open/pending" control; replaced with a single explicit "⏸ Pending" / "↩ Resume" button next to "✓ Close". (`29752ad`)
- `AdminIntegrationsPage`: the long "Sync queue" section is now inside `<details>`, collapsed by default, auto-opens on error/skipped. Summary shows ⚠ errors / ⏸ skipped / ⏳ pending counters. (`29752ad`)
- `Layout` + `CommandPalette`: new `adminOnly` flag. "Integrations" is now admin-only. (`29752ad`)

**Removed (public site)**
- Decorative `hero-flourish` SVG next to the AlesSanna logo. (`796b07a`)
- Two paragraphs in the "About" section. (`796b07a`)

**Stable tags**
- `stable-2026-04-19-crm-ux` → `29752ad`
- `stable-2026-04-19-public-site-cleanup` → `796b07a`

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
