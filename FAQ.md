# FAQ — Alessanna platform

> Двуязычный FAQ. Если ответы на ваш вопрос нет — открывайте [issue](https://github.com/osminoog09-star/alessanna/issues) или пишите через виджет техподдержки на сайте.
>
> Bilingual FAQ. If your question is not covered — open an [issue](https://github.com/osminoog09-star/alessanna/issues) or use the support chat widget on the site.

---

## Русский

### Что это вообще?

Стек для премиум-салона из 3 кусков:

1. **Публичный сайт** — статический HTML/CSS/JS из корня репо, хостится на **GitHub Pages** (`alessannailu.com`).
2. **CRM** — Vite + React + Supabase, в папке `work/`, хостится на **Vercel** (`work.alessannailu.com`).
3. **API + база** — два варианта:
   - **Supabase** (Postgres + RLS) — основной production-режим;
   - локальный Node + SQLite (`server/`) — для dev / fallback / демо.

### Где админка / логины?

CRM открывается на `https://work.alessannailu.com`. Логин — **по QR-коду + телефону мастера**, без паролей. Аккаунт мастера заводится в CRM на странице `Сотрудники`.

### Сайт сломался / отдаёт 404 на `/work/`

Это так задумано: GitHub Pages намеренно публикует только лендинг (`index.html` и пр.), а `/work/` редиректит на `work.alessannailu.com`. Если вы видите «голый Vite source» — у вас старый кэш Pages, дождитесь пересборки воркфлоу `Deploy GitHub Pages`.

### CRM показывает 4xx в DevTools

Большинство 4xx — это PostgREST не нашёл колонку (старая БД, нет миграции). Все добавления колонок идемпотентны и лежат в `supabase/migrations/`. Самое простое — прогнать ВСЕ миграции по порядку через Supabase Dashboard → SQL Editor или `supabase db push`.

Конкретно после октября 2026 нужны миграции **022, 023, 030, 031, 032, 033, 034** — без них падает FinancePage, AnalyticsPage, SiteBuilderPage и публичные booking-страницы.

### Виджет чата теряется на тёмном фоне

Это пофикшено в коммите `ca412f0` (`feat(site-support-chat): redesign panel/launcher visibility on dark backgrounds`). Если у вас старый билд — обновите страницу с очисткой кэша (Ctrl+Shift+R).

### При записи показывает «всех мастеров», даже тех, кто услугу не делает

Тоже пофикшено в `e4aa7db`. Источник истины — таблица `staff_services` в Supabase. Если мастер всё равно «вылетает», проверьте в CRM на странице `Сотрудники → Услуги мастера` — он должен быть в **Активных услугах** для соответствующей категории.

### Почему 12 ошибок TypeScript, а билд проходит?

Vite билдит `transform-only` — он игнорирует ошибки типов. Это технический долг, который мы накапливали после миграций схемы (UUID vs bigint, новые колонки и т.д.). По состоянию на коммит `0ed84c5` весь долг закрыт: `tsc --noEmit` PASS, `vite build` PASS (~2.4 s, 196 KB gz).

### Как добавить нового мастера?

CRM → `Сотрудники` → `Добавить`. Заполнить имя + телефон. Выдать роль (`worker` / `manager` / `admin`). Затем перетащить нужные категории услуг из «Неактивные» в «Активные» (DnD работает с коммита `0ed84c5`).

### Как мастер логинится?

Открывает CRM на телефоне, жмёт «Войти», вводит телефон. Система звонит/SMS-кодом валидирует через RPC `verify_staff_phone`. Никаких паролей у мастеров нет.

### Что с переводами? Есть эстонский?

Да, в `locales/` лежат `ru.json`, `en.json`, `et.json`. На лендинге язык переключается флажком в шапке. CRM — пока RU + EN.

### Как пушить изменения?

`main` → автодеплой:
- GitHub Actions деплоит лендинг (~1–2 мин).
- Vercel пересобирает CRM на каждый push в `main` (~1 мин).
Никаких ручных команд деплоя не нужно.

### Где лежат секреты?

- `.env.example` — шаблон для локального dev.
- В Vercel: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (оба `Production` + `Preview`).
- Supabase service-role ключ **в репо не лежит и в браузер не уходит** — только серверные RPC под RLS.

---

## English

### What is this?

A premium-salon stack with 3 parts:

1. **Public site** — static HTML/CSS/JS at the repo root, hosted on **GitHub Pages** (`alessannailu.com`).
2. **CRM** — Vite + React + Supabase under `work/`, hosted on **Vercel** (`work.alessannailu.com`).
3. **API + DB** — two options:
   - **Supabase** (Postgres + RLS) — main production setup;
   - local Node + SQLite (`server/`) — for dev / fallback / demo.

### Where is the admin panel / login?

The CRM is at `https://work.alessannailu.com`. Login is **by QR + staff phone number**, no passwords. New accounts are created from the CRM `Staff` page.

### The site is broken / returns 404 on `/work/`

That is on purpose: GitHub Pages intentionally publishes only the landing page (`index.html` etc), and `/work/` redirects to `work.alessannailu.com`. If you see raw Vite source it is a stale Pages cache — wait for the `Deploy GitHub Pages` workflow to finish.

### CRM shows 4xx in DevTools

Most 4xx mean PostgREST did not find a column (old DB without a migration). All column additions are idempotent and live under `supabase/migrations/`. Easiest fix: run all migrations in order via Supabase Dashboard → SQL Editor or `supabase db push`.

Specifically, after October 2026 you need migrations **022, 023, 030, 031, 032, 033, 034** — without them FinancePage, AnalyticsPage, SiteBuilderPage and public booking pages will break.

### The chat widget gets lost against the dark background

Fixed in commit `ca412f0` (`feat(site-support-chat): redesign panel/launcher visibility on dark backgrounds`). If you still see the old version — hard-refresh (Ctrl+Shift+R).

### Booking shows "all masters" even those who don't do the service

Also fixed in `e4aa7db`. Source of truth is the `staff_services` table in Supabase. If a master is still showing up wrongly, double-check in the CRM `Staff → Services` view — they must be in **Active services** for the relevant category.

### Why 12 TypeScript errors but build passes?

Vite is `transform-only` — it ignores type errors. This was tech debt accumulated after schema migrations (UUID vs bigint, new columns, etc). As of commit `0ed84c5` the debt is fully cleared: `tsc --noEmit` PASS, `vite build` PASS (~2.4 s, 196 KB gz).

### How do I add a new master?

CRM → `Staff` → `Add`. Set name + phone. Assign a role (`worker` / `manager` / `admin`). Then drag the relevant service categories from "Inactive" into "Active" (DnD works as of commit `0ed84c5`).

### How does a master log in?

Open the CRM on a phone, tap "Sign in", enter phone number. The system validates via RPC `verify_staff_phone` (SMS code). Masters have no passwords.

### What about translations? Estonian?

Yes — `locales/` has `ru.json`, `en.json`, `et.json`. On the landing the flag in the header switches languages. CRM currently ships RU + EN.

### How do I push changes?

`main` → auto-deploy:
- GitHub Actions deploys the landing (~1–2 min).
- Vercel rebuilds the CRM on every push to `main` (~1 min).
No manual deploy commands required.

### Where are the secrets?

- `.env.example` — local dev template.
- In Vercel: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (both `Production` + `Preview`).
- The Supabase **service-role** key is **never committed and never reaches the browser** — only server-side RPCs under RLS.
