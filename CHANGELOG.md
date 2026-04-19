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

## 2026-04-19 (поздно вечером) — «Полный аудит: БД-гигиена, P1-фиксы CRM, починка блока «Мастера» на сайте»

### Russian

**БД-гигиена и безопасность (миграция `040_db_hygiene_fk_indexes_and_search_path.sql`)**

- **Индексы на FK.** Supabase advisor показал 13 foreign key без покрывающих
  индексов (`appointment_services.appointment_id/service_id/staff_id`,
  `appointments.client_id/service_id/staff_id`, `service_listings.category_id`,
  `staff_schedule.staff_id`, `staff_services.service_id/staff_id`,
  `staff_time_off.staff_id`, `support_messages.sender_staff_id`,
  `support_threads.assigned_by_staff_id`). Добавили все. Это критично
  для cascade-delete (когда удаляем мастера, Postgres сканирует FK без
  индекса фуллскэном — на больших таблицах будет тормозить).
- **`search_path`** для трёх SECURITY-чувствительных функций
  (`google_oauth_tokens_touch_updated_at`, `notifications_outbox_touch_updated_at`,
  `_support_topic_prefix`) явно зафиксирован = `public`. Без этого SECURITY DEFINER
  функция теоретически может получить «не свою» схему через `set_config`
  в сессии — стандартное замечание security advisor.
- **Deny-all RLS** для `support_threads` / `support_messages` для anon и
  authenticated (мы уже ходим туда только через `support_*` RPC,
  но раньше политик вообще не было — RLS включён без полиси = «никому,
  включая RPC через service_role», а с явным deny — намерение читается).

**P1-фиксы CRM по результатам кода-аудита**

- **`AdminSchedulePage`.**
  - При выборе режима «всем сразу» (`__ALL__`) сетка не сбрасывалась —
    можно было случайно сохранить «прошлый» график (одного человека) на
    всю команду. Теперь при переключении на «всем» рисуем чистый шаблон
    `emptyWeek()`.
  - При сохранении проверяем, что `start < end` для всех working-строк;
    раньше можно было сохранить «10:00 → 09:00».
  - `delete().eq("staff_id", staffId)` молча игнорил ошибку — теперь
    показываем её через `setErr`, не уходя в insert «поверх» прошлого.
- **`FinancePage`.**
  - **`work_type='salary'`** считался как `percentage` (с `rate=NULL → 0`),
    итог: «доля мастера = 0 €, доля салона = 100%». Для оклада это
    неправильное представление, теперь явная ветка: окладник → доля салона
    100% от выручки (зарплата выплачивается отдельным потоком).
  - Ошибки supabase-запросов **молча игнорировались** — теперь `err`
    показывается над таблицей.
  - `useFinanceRealtime` подписан на `staff_work_days` (раньше только
    appointments/services), чтобы пересчёт «рабочих дней» был мгновенным.
  - **Добавлены недостающие i18n-ключи** `finance.*` и
    `adminStaff.payModel/payRent/payPercentage/paySalary` во все 4 локали
    (ранее на странице висели сырые ключи как «технический мусор»).
- **`SiteBuilderPage`.**
  - Кнопка `Publish` без подтверждения и без отката — между `delete blocks`
    и `insert blocks` могла «убить» прошлую опубликованную версию страницы.
    Теперь: `confirm()` → бэкап старых блоков в памяти → delete → insert →
    при ошибке insert восстанавливаем бэкап. Кнопка дизейблится во время
    публикации, появляется зелёный статус.
- **`AdminStaffPage`.**
  - `staff_services` загружался без проверки `error` — если запрос упадёт
    (RLS / network), на странице тихо пропадут все «галки услуг» у
    мастеров, и нельзя понять что произошло. Теперь явный `setErr`.

**Публичный сайт (`alessannailu.com`) — блок «Мастера»**

- **Симптом:** под заголовком «Мастера» висит «Состав команды
  подгружается из CRM…» и не сменяется на список. Услуги (site-services.mjs)
  при этом грузятся нормально, календарь показывает «Много окон».
- **Гипотезы (без полного исправления — нужен релиз):**
  - `site-team.mjs` подключался без cache-bust, возможна старая
    закэшированная версия с устаревшей схемой. Добавили `?v=20260420j`,
    чтобы CDN/Cloudflare обновили модуль.
  - В `site-team.mjs` все ошибки supabase молча терялись (`const { data } = await ...`
    без `.error`). Сделали полный logging: `console.info/warn/error` с
    префиксом `[site-team]` для каждой стадии (resolve config, staff query,
    staff_services join). Если что-то упадёт — будет видно в DevTools.
  - Добавили graceful fallback: если `staff_services` join упал,
    рендерим плоский список мастеров без группировки по категориям —
    лучше «Meistrid: Александр, Анна» чем висящее «подгружается…».
- **Что ещё проверить после релиза:** `/book` отдаёт 404 (GitHub Pages
  отдаёт 404.html). Если этот URL должен работать — нужен либо
  `book.html` в корне репо, либо редирект `index.html#broneeri`.

### English

**DB hygiene & security (migration `040_db_hygiene_fk_indexes_and_search_path.sql`)**

- **FK indexes.** Supabase advisor flagged 13 foreign keys without
  covering indexes. Added all. Critical for cascade-deletes on big tables.
- **`search_path`** locked to `public` for three SECURITY DEFINER-style
  functions (`google_oauth_tokens_touch_updated_at`,
  `notifications_outbox_touch_updated_at`, `_support_topic_prefix`).
- **Deny-all RLS** for `support_threads` / `support_messages` (anon +
  authenticated). We only go through `support_*` RPCs anyway; explicit
  deny makes intent clear.

**CRM P1 fixes from code audit**

- **`AdminSchedulePage`** — reset to empty grid when switching to
  "all staff" mode; validate `start < end`; surface `delete()` errors.
- **`FinancePage`** — proper `salary` work_type math; surface supabase
  errors; subscribe finance realtime to `staff_work_days`; add missing
  `finance.*` and `adminStaff.pay*` i18n keys to all 4 locales.
- **`SiteBuilderPage`** — `Publish` now asks confirmation, backs up old
  blocks in memory, restores on insert failure, shows progress.
- **`AdminStaffPage`** — surface `staff_services` load errors instead
  of silently dropping the "skills" grid.

**Public site team block fix-attempt**

- "Состав команды подгружается из CRM…" stuck below the "Мастера"
  heading. Added cache-bust to `site-team.mjs`, full
  `console.info/warn/error` logging, and a graceful fallback to a flat
  master list if the `staff_services` join fails.

### Notes

- 4 коммита (calendar, services, time-off, support) уже на проде —
  «Новая запись» и поездка в Google Calendar проверены живьём, тестовая
  бронь создана и удалена, `notifications_outbox` строит payload
  корректно.

---

## 2026-04-19 (вечер) — «`/admin/calendar`: чиним «Новая запись» — пустой dropdown услуг + молчаливое падение `source`»

### Russian

**Исправлено (`/admin/calendar` модалка «Новая запись»)**

- **Блокер №1 — пустой dropdown «Услуга».** На проде в модалке нельзя
  было выбрать услугу: список был пуст, кнопка «Сохранить» ничего не
  делала. Причина: `CalendarPage` грузил каталог только из legacy-таблицы
  `services` (`active=true`), а актуальный каталог давно живёт в
  `service_listings` (UUID, `is_active`). Таблица `services` на проде
  пустая (0 строк) — отсюда пустой select.
- Решение: единый хелпер `lib/loadServicesCatalog.ts` — приоритет
  `service_listings` (с join на `service_categories`), fallback на
  legacy `services` (с обоими наборами колонок: `name_et/price_cents/duration_min`
  и `name/price/duration`). Поле `active` нормализуется (`is_active !== false`).
- На safe-net: если `eligibleServices` всё-таки пуст, теперь показываем
  явное сообщение «Нет доступных услуг…» вместо пустого dropdown,
  и кнопка «Сохранить» дизейблится (`pickService` ловит руками).
- **Блокер №2 — silent-fail при insert.** Даже если бы dropdown
  заполнился, INSERT падал бы с PostgREST-ошибкой:
  `Could not find the 'source' column of 'appointments' in the schema cache`.
  Колонка `source` была удалена из `public.appointments` ранее (миграции
  cleanup-серии 030/031), но фронт продолжал слать `source: "manual"`
  (`BookingModal`) и `source: "online"` (`PublicBookingPage`). Поля
  убраны из payload.

**Исправлено (БД, миграция 039 `outbox_payload_match_appointments_schema`)**

- Триггер `enqueue_appointment_outbox` собирал payload из несуществующих
  колонок `new.source` и `new.notes`. Был обёрнут в
  `exception when others then raise warning … return new;`, поэтому
  INSERT в `appointments` проходил молча, но строка в
  `notifications_outbox` НЕ создавалась — события Google Calendar не
  отправлялись. На проде `notifications_outbox` пустой (0).
- Теперь `source` подставляется константой `'manual'`, а вместо `notes`
  читается актуальная колонка `note` (миграция 030 переименовала её).

**Аудит (по ходу)**

- Проверены все RPC, которые дёргает фронт CRM
  (`support_staff_*`, `outbox_*`, `staff_google_calendar_disconnect`,
  `verify_staff_phone`, `public_book_chain`) — все на месте.
- Проверены типы колонок: `appointments.service_id`, `staff_services.service_id`,
  `service_listings.id` — все `uuid`, можно писать UUID каталога без
  конверсии.
- `BookingsPage`/`AnalyticsPage` уже мерджат `services` + `service_listings`
  для отображения (норм).
- `AdminStaffPage`/`ServicesPage` уже имеют listings-first fallback (норм).

### Estonian

**Parandatud (`/admin/calendar` modaal «Uus broneering»)**

- Töötajal polnud tootmises võimalik luua broneeringut: rippmenüü
  «Teenus» oli tühi. Põhjus: kalender luges teenuseid ainult vanast
  tabelist `services` (mis on tühi), uus kataloog `service_listings` jäi
  ignoreerituks. Lahendus: ühtne abifunktsioon
  `lib/loadServicesCatalog.ts` (prioriteet `service_listings`, fallback
  legacy). Kui teenuseid ikka pole, näidatakse selget hoiatust.
- INSERT teenusesse `appointments` kukkus vaikselt läbi PostgREST'i
  schema-cache'i tõttu (kasutati eemaldatud veergu `source`). Eemaldatud
  nii `BookingModal`-ist kui `PublicBookingPage`-st.

**Parandatud (DB, migratsioon 039)**

- Trigger `enqueue_appointment_outbox` luges olematuid veerge
  `new.source` ja `new.notes`, mistõttu `notifications_outbox` jäi
  tühjaks ning Google Calendari sündmusi ei edastatud. Nüüd kasutatakse
  konstandi `'manual'` ja õiget veergu `note`.

---

## 2026-04-19 (под утро) — «`/admin/time-off`: иконка календаря + пресеты + длительность»

### Russian

**Изменено (`/admin/time-off`)**

- В полях «Начало» / «Конец» появилась **видимая иконка календаря слева** —
  раньше в тёмной теме индикатор у `<input type="datetime-local">` был
  почти не виден, и кликать было непонятно куда. Иконка кликабельная
  (открывает native picker через `showPicker()` с фолбэком на `focus()`).
- `[color-scheme:dark]` — встроенный индикатор Chrome/Edge тоже стал
  светлым на чёрном фоне, не сливается.
- Поля встали в **2 колонки** на десктопе (раньше было 2 строки подряд).
- **Быстрые пресеты** одним кликом:
  - «Сейчас на 1 час» — с округлением минут до 5.
  - «Весь день» — `00:00–23:59` от выбранной (или сегодняшней) даты.
  - «Завтра, 9–18» — типичный рабочий день.
- При выборе «Начала», если «Конец» пустой — авто-подставляется
  `start + 1 час` (самый частый паттерн).
- Под полями показывается **длительность блока** («2 ч 30 мин»)
  и предупреждение «⚠ Конец должен быть позже начала».
- Кнопка «Добавить» **disabled**, пока пара невалидна (нет сотрудника /
  пустые даты / `end ≤ start`).
- У поля «Причина» появился placeholder-пример.

**Не меняли:** структуру БД, RPC, RLS — это чисто UI-фикс.

**Smoke**

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (811 KB JS, +5 KB к 806 KB).

### English

**Changed (`/admin/time-off`)**

- Visible calendar icon to the left of "Start/End" fields (was almost invisible
  in dark theme). Click opens the native picker via `showPicker()` with
  `focus()` fallback. `[color-scheme:dark]` makes the built-in indicator legible.
- Quick presets: "Now +1 hour", "Whole day", "Tomorrow 9–18".
- Auto-suggest `end = start + 1h` when end is empty.
- Live duration label + "end must be after start" validation.
- "Add" button disabled until the pair is valid.

No DB/RPC changes. tsc + build green.

---

## 2026-04-19 (поздно ночью) — «`/admin/services`: аккордеон + фильтры + сортировка»

### Russian

**Изменено (`/admin/services`)**

- Карточка услуги теперь по умолчанию **свёрнутая**: одна строка-сводка
  `[●] Название · 18.00€ · 30 мин · +10 · 👤 N · ⚠/не на сайте · [тумблер]`.
  Клик по строке (или по галочке слева) раскрывает полный редактор —
  тот же, что был раньше (название/цена/длительность/пауза/категория/мастера/удалить).
  Это решает «портянку из 30 одновременно открытых форм» и оставляет всю мощность редактирования.
- Заголовок секции категории теперь **сворачивается кликом** — стрелка ⌄/›
  рядом с названием. Свёрнутая категория не рендерит свои услуги (быстрый scroll).
- Новая полоса **«Фильтры»** под поиском (раскрывается отдельной кнопкой):
  - Статус: «Все / Только активные / Только выключенные».
  - Проблемы: «⚠ Без мастеров», «Не на главной».
  - Категории: чипы-мульти-фильтр.
  - Сортировка: по названию (А→Я), цена ↑/↓, длительность ↑/↓, «больше мастеров — выше».
  - Бейдж со счётчиком активных фильтров на самой кнопке + кнопка «Сбросить».
- Над списком — счётчик `N из M найдено` + кнопки **«Развернуть всё»** и
  **«Свернуть всё»** (управляют видимыми услугами, удобно для аудита).
- Все предпочтения (раскрытые услуги, свёрнутые категории, фильтры, сортировка,
  показан ли тулбар) сохраняются в `localStorage` под ключом `admin/services/v1` —
  при возврате на страницу всё восстанавливается.

**Что НЕ меняли (намеренно):**

- Структура БД и RPC — без изменений. Это чисто UI/UX.
- Логика сохранения (`saveService`, `replaceServiceStaffLinks`, `addService`,
  `deleteService`, `quickCreate`-модал) — без изменений.
- Шапка страницы (статы «Всего/Активных/На главной», кнопки
  «Проверить главную / Обновить всё на сайте / Добавить услугу»),
  блок «Категории» (CRUD категорий) и поиск по названию — без изменений.

**Smoke**

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (806 KB JS, +11 KB к 795 KB).
- Live UI на проде — за владельцем (нужен PIN).

**Файлы**

- `work/src/pages/ServicesPage.tsx` — основные правки.
- `RELEASES.md`, `CHANGELOG.md` — обновлены.

### English

**Changed (`/admin/services`)**

- Service card now collapses by default into a single summary row
  `[●] Name · 18.00€ · 30 min · +10 · 👤 N · ⚠/not-on-site · [toggle]`.
  Click expands the full editor (name/price/duration/buffer/category/masters/delete).
- Category headers are now collapsible (chevron + click).
- New filter bar under the search (toggleable):
  status (all/active/inactive), problems (⚠ no masters / not on main),
  category multi-chip filter, sort by name/price/duration/master-count.
- "Expand all / Collapse all" buttons + "N of M found" counter.
- All UI prefs persist in `localStorage` (`admin/services/v1`).

No DB/RPC changes. tsc + build green. Live prod smoke pending.

---

## 2026-04-19 (ночь) — «Support: assignment + display IDs + IP/abuse signals + stats»

### Russian

**Добавлено (`/admin/support`, БД)**
- **«Закрепить за собой» / «Снять с себя» / «Передать другому…»** — у каждого обращения теперь есть явный ассайни. Менеджер видит «закреплено за: Имя» в списке и в шапке треда; может взять свободный тред себе и снять с себя. **Только админ** может перехватить чужой тред или передать его кому-то другому через выпадающий список активных сотрудников. История назначения хранится: `assigned_at` + `assigned_by_staff_id` (кто закрепил), чтобы при споре «а кто его взял?» можно было ответить точно.
- **Человекочитаемые ID обращений** — `SAL-000123` (запрос в салон), `SIT-000045` (техподдержка сайта), `EMP-000012` (тикет от сотрудника CRM). Триггер `_support_assign_display_id` ставит ID на BEFORE INSERT, на каждый `topic` — отдельный sequence. Backfill пробежал по всем существующим тредам в порядке даты создания. ID видно в списке слева (мелким моноширинным) и chip'ом в шапке детали — можно цитировать в звонке/чате: «открой SAL-000123».
- **IP клиента + device fingerprint** — при создании треда из публички в БД пишется `client_ip` (читается из заголовков PostgREST: `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`, безопасно через хелпер `_support_request_ip()`, при ошибке парсинга — `null`) и `device_fingerprint = sha256(user-agent + accept-language)`. **IP виден только админу** (host(inet) → строка), менеджер получает только обезличенные счётчики. Тикеты сотрудников (`topic='staff'`) от этого исключены — для них «мошенник» не имеет смысла, а IP/fp пишется только для аудита.
- **Anti-abuse флаг «⚠ Подозрительно»** — обращение помечается, если за последние 24 часа с того же IP **или** с того же `device_fingerprint` пришло ≥5 тредов (исключая `topic='staff'`). Бейдж видно в списке (иконка ⚠ перед именем) и в шапке детали (chip «Подозрительно»), плюс отдельная плитка в общем дашборде «Подозрительных за 24ч».
- **Дашборд статистики** — компактная панель из 5 плиток над списком: «Открытых», «В ожидании», «Без ассайни», «Мои», «Средн. ответ» (среднее время до первого ответа staff'а за 30 дней). Шестая плитка («Подозрительных») появляется только когда счётчик > 0. Считается на стороне БД через `support_staff_stats(p_staff_id, p_topic_filter)`, обновляется каждые 5 секунд вместе со списком.
- **«Тех. контекст»** — узкая полоска под шапкой треда (видна только при наличии данных): IP (если admin), кол-во обращений за 24ч с этого IP / устройства, короткий хеш fingerprint, обрезанный UA. При `is_suspicious=true` полоска становится пунцовой.

**Изменено (БД, RPC поддержки)**
- `support_visitor_start_thread` и `support_staff_self_open` теперь дополнительно пишут `client_ip`, `client_ip_set_at`, `device_fingerprint` через `_support_request_ip()` + sha256 заголовков.
- `support_staff_list_threads` возвращает `display_id`, `assigned_staff_name`, `is_suspicious`.
- `support_staff_fetch_messages` возвращает `display_id`, `assigned_staff_name`, `assigned_at`, `assigned_by_staff_name`, `client_ip` (только admin), `device_fingerprint_short`, `ip_threads_24h`, `device_threads_24h`, `is_suspicious`.
- `support_staff_update_thread` получил параметр `p_clear_assignee boolean` (по умолчанию `false`). RLS по правам: менеджер может только взять «себе» свободный тред или снять «с себя», админ — что угодно. Любая попытка менеджера перехватить чужой тред → `access_denied`.
- Новый RPC `support_staff_stats(p_staff_id, p_topic_filter)` для дашборда.

**Тех. детали миграции**
- Файл: [`supabase/migrations/038_support_assignment_ids_ip_stats.sql`](./supabase/migrations/038_support_assignment_ids_ip_stats.sql) (на проде применена 4 транзакциями `038`, `038b`, `038c`, `038d` через MCP, чтобы атомарно по разделам).
- Идемпотентно: все `add column if not exists`, `create … if not exists`, `create or replace function`. Можно прогонять повторно.
- Проверка: `select public.support_staff_stats('<admin-id>'::uuid, null)` → `{open, pending, unassigned, mine, avg_first_response_seconds, closed_24h, closed_7d, suspicious_24h}`.

**Smoke (БД, прод)**
- Display_id выставлен у всех 6 существующих тредов корректно по дате (SAL-000001..003, SIT-000001..002, EMP-000001).
- `support_staff_stats` для Дениса: `{open: 1, mine: 1, closed_24h: 1, closed_7d: 5, avg_first_response_seconds: 100, suspicious_24h: 0}`.
- `support_staff_list_threads` возвращает `display_id`, `assigned_staff_name='Денис'`, `is_suspicious=false` для всех.

**Smoke (CRM, локально)**
- `npx tsc --noEmit` — чисто.
- `npm run build` — чисто, 795 KB бандл (без изменений размера от факта добавления `StatTile`/типов).
- Live UI smoke на проде — за владельцем (нужна реальная сессия с PIN).

### English

**Added (`/admin/support`, DB)**
- **"Assign to me" / "Release" / "Transfer to…"** — every conversation now has an explicit assignee. Managers see a "Assigned to: Name" chip in both the list and the thread header; they can claim a free thread or release their own. **Only admins** can override an existing assignee or transfer to another staff via a popover with active staff. Assignment history kept: `assigned_at` + `assigned_by_staff_id`.
- **Human-readable thread IDs** — `SAL-000123` (salon inquiry), `SIT-000045` (site tech support), `EMP-000012` (employee internal ticket). `BEFORE INSERT` trigger picks the next value from one of three sequences keyed by `topic`. Backfill ran over all existing threads ordered by `created_at`. ID visible in list (mono-spaced small) and as a chip in the detail header — quotable in calls/chats.
- **Client IP + device fingerprint** — captured at thread-creation time. IP read from `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` via `_support_request_ip()` helper; gracefully `null` on parse error. Fingerprint = `sha256(user-agent + accept-language)`. **IP visible to admins only**; managers see only anonymised 24h counters. Employee tickets (`topic='staff'`) excluded from abuse scoring.
- **Anti-abuse flag "⚠ Suspicious"** — set when ≥5 threads in last 24h share the same IP **or** the same fingerprint (excluding employee tickets). Shown as ⚠ in the list, as a "Suspicious" chip in the header, and as its own dashboard tile when count > 0.
- **Stats dashboard** — compact 5-tile panel above the list: open / pending / unassigned / mine / avg first reply (30d). Sixth tile ("Suspicious") appears only when > 0. Computed server-side via `support_staff_stats`, refreshed every 5 s.
- **"Tech context"** strip — IP (admin only), 24h thread counts per IP / per device, short fingerprint, trimmed UA. Strip turns rose-coloured when `is_suspicious`.

**Changed (DB, support RPCs)**
- `support_visitor_start_thread` and `support_staff_self_open` write IP + fingerprint.
- `support_staff_list_threads` returns `display_id`, `assigned_staff_name`, `is_suspicious`.
- `support_staff_fetch_messages` returns assignment info, IP (admin only), abuse signals.
- `support_staff_update_thread` got `p_clear_assignee boolean`. Manager-only rules enforced server-side.
- New RPC `support_staff_stats`.

**Migration tech**
- File: `supabase/migrations/038_support_assignment_ids_ip_stats.sql`. On prod applied as 4 atomic chunks (`038`, `038b`, `038c`, `038d`).
- Idempotent — all `if not exists` / `create or replace`.

---

## 2026-04-19 (поздний вечер) — «Cart bump effect, no auto-open»

### Russian

**Изменено (публичный сайт, корзина «Ваш выбор»)**
- При первом добавлении услуги корзина больше **не раскрывается автоматически**, перекрывая прайс. Теперь она появляется как узкая вертикальная закладка справа внизу с надписью «ВАШ ВЫБОР [N]». Это feedback от владельца после ревью скриншота.
- Чтобы клиент всё-таки понял «услуга добавилась», добавлен короткий (~0.7s) **эффект-«пульс»** на кнопку корзины: scale(1) → scale(1.12) с золотым кольцом, плюс pop-анимация бейджа-счётчика (масштабируется до ×1.5 с тёплым акцентным фоном). Срабатывает только при ДОБАВЛЕНИИ (не при удалении), сравниваем `picked.length` с предыдущим значением. `prefers-reduced-motion: reduce` гасит анимацию.
- Развернуть корзину — по клику пользователя; preference в `localStorage` больше не подсасывается на init (чтобы не было неприятных сюрпризов «открылось само, потому что когда-то ты её разворачивал»).
- Smoke-протестировано локально (browser-use): 1 услуга → закладка свернута и пульсирует; 2-я услуга (другая категория) → счётчик стал 2, закладка осталась свернутой, прайс полностью виден.

**Добавлено (`RELEASES.md`)**
- Закреплено формальное «правило техники безопасности»: рискованные правки (форма записи, RPC, RLS, миграции, расписание) сначала проверяются локально + браузером + (если нужно) против локальной/staging-Supabase, и только потом мёрджатся в `main`. Это правило теперь часть процесса релиза.

**Стабильная точка**
- `stable-2026-04-19-site-cart-bump-no-autoopen` → (см. `RELEASES.md`)

### English

**Changed (public site, cart "Your selection")**
- After adding the first service the cart no longer **auto-expands** and covers the price list. It appears as a slim vertical tab in the bottom-right ("YOUR SELECTION [N]"), per owner feedback on the screenshot.
- To still confirm "the service was added", a short (~0.7s) **bump animation** plays on the cart button: scale(1) → scale(1.12) with a gold ring + pop on the count badge (scale to ×1.5, warm accent bg). Triggers only on ADD (not on remove); we compare `picked.length` to the previous render. `prefers-reduced-motion: reduce` mutes the animation.
- Expanding the cart is now strictly user-initiated; we no longer read the dock-collapse preference from `localStorage` on init (so users aren't surprised by "it opened by itself because I once expanded it").
- Local smoke (browser-use): 1 service → tab collapsed and pulsed; adding a 2nd service from a different category → counter became 2, tab stayed collapsed, price list fully visible.

**Added (`RELEASES.md`)**
- Pinned a formal "safety rule": risky changes (booking form, RPCs, RLS, migrations, scheduling) are first verified locally + via browser smoke + (if needed) against local/staging Supabase, and only then merged into `main`. This rule is now part of the release process.

**Stable point**
- `stable-2026-04-19-site-cart-bump-no-autoopen` → (see `RELEASES.md`)

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
