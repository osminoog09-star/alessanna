# Alessanna platform

> 🇷🇺 README на двух языках — русская часть сверху, English ниже. Полная документация в файлах ниже.
>
> 🇬🇧 Bilingual README — Russian section first, English follows. Full docs in the files listed below.

## Docs / Документация

| Файл / File | RU | EN |
|------|----|----|
| [`FAQ.md`](./FAQ.md) | Частые вопросы | Frequently Asked Questions |
| [`CHANGELOG.md`](./CHANGELOG.md) | Патчноуты по релизам | Release patch notes |
| [`ROADMAP.md`](./ROADMAP.md) | Что впереди | What is next |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Архитектура (high-level) | Architecture (high-level) |

---

## 🇷🇺 Русский

Премиум-стек для салона: **публичный сайт** (статический HTML в корне репо), **REST API** (локальный Node-сервер), **онлайн-запись** и **CRM** на **Vite + React** в папке **`work/`** (деплой на **Vercel**, домен **work.alessannailu.com**). Старая папка **`work-crm/`** — необязательный Next.js прототип, **не используется** для прод-CRM.

### Прод-хостинг (домены)

| Домен | Что крутится | Как |
|------|------|-----|
| **https://alessannailu.com** | Маркетинговый лендинг (`index.html`, `styles.css`, `script.js`, …) | **GitHub Pages** через **GitHub Actions** (`.github/workflows/pages.yml`) — публикует только whitelist статических файлов, а не всё репо. |
| **https://work.alessannailu.com** | Стафф-CRM (Vite-приложение в **`work/`**) | **Vercel** — смотри **`work/vercel.json`** при **Root Directory = `work`** (`outputDirectory`: **`dist`**). Если **Root Directory** пустой — берётся корневой **`vercel.json`** (`outputDirectory`: **`work/dist`**). |

**DNS (не путать):**

- **alessannailu.com** → GitHub Pages ([записи GitHub](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)).
- **work** саб-домен → Vercel (CNAME на `cname.vercel-dns.com` или то, что показывает Vercel-проект).

**Настройка GitHub Pages:** Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. После первого прогона **Deploy GitHub Pages** в **Custom domain** ставим `alessannailu.com` и включаем **HTTPS** (GitHub возьмёт **`CNAME`** из артефакта).

**Настройка Vercel (один из двух вариантов):**

1. **Root Directory = `work`** (типовой): Vercel читает **`work/vercel.json`** — **`buildCommand`** `npm run build`, **`outputDirectory`** **`dist`**, **`framework`** **Vite**. **`work/dist`** тут писать **нельзя** — root уже **`work/`**.
2. **Root Directory пустой**: корневой **`vercel.json`** — **`cd work && …`**, **`outputDirectory`** **`work/dist`**, **`installCommand`** **`true`**, чтобы корневой `package.json` (с `better-sqlite3`) не ставился на Vercel.

Env-переменные для CRM (Vercel → **Settings → Environment Variables**, включить для **Production** и **Preview** — Vite зашивает их на этапе **build**):

- **`VITE_SUPABASE_URL`** — например `https://eclrkusmwcrtnxqhzpky.supabase.co`
- **`VITE_SUPABASE_ANON_KEY`** — Supabase **publishable** / **anon** ключ (безопасен в браузере, данные защищаем через **RLS**)

Локальный dev: копируем **`work/.env.example`** → **`work/.env`** и проставляем ключ (`work/.env` в `.gitignore`).

**Почему Pages через Actions?** Если публиковать **всё** репо с ветки `/`, то `https://alessannailu.com/work/` отдаст **исходники Vite** `work/index.html` (на статике это не работает). Workflow публикует только реальные файлы лендинга и подменяет **`/work/`** на **редирект-заглушки** на work.alessannailu.com.

Локальный билд CRM (перед пушом):

```bash
cd work
npm install
npm run build
```

Ожидаем **`work/dist/index.html`** (и ассеты под **`work/dist/assets/`**).

### Быстрый старт (локально)

1. Установи [Node.js](https://nodejs.org/) 18+.
2. `npm install`
3. Скопируй `.env.example` → `.env`, проставь `JWT_SECRET`.
4. `npm start`
5. Открой `http://localhost:3000/` — публичный сайт.
   Открой `http://localhost:3000/work/` — CRM (с лендинга на CRM ссылок нет).

При первом запуске создаётся `data/salon.db` и сидятся **аккаунты сотрудников** (используются QR-пикером).

### Логин в CRM: только QR (по умолчанию)

1. На **десктопе** открываем `/work/` — появляется **QR-код** (сессия ~2 мин).
2. **Сканируем** телефоном — открывается `/work/m/?token=…`.
3. **Тапаем своё имя** — десктоп **поллит** `/api/auth/qr/status` каждые **2с** и получает **httpOnly JWT**-cookie.

Никаких паролей в CRM-UI нет. Аварийный break-glass: ставим `ALLOW_PASSWORD_LOGIN=true` и используем `POST /api/auth/login` (демо-пароли ниже).

### Demo-аккаунты (для QR-списка на телефоне)

Те же пользователи появляются в телефоне после скана. Для аварийного логина по паролю (только если `ALLOW_PASSWORD_LOGIN=true`) — пароль **`salon2026`**:

| Роль     | Email                 |
|----------|------------------------|
| Admin    | `owner@alessanna.local` |
| Manager  | `manager@alessanna.local` |
| Employee | `staff@alessanna.local` (Galina) |

### Публичная онлайн-запись

При запущенном сервере `script.js` детектит `/api/health` и:

- грузит **сотрудников** и **услуги** из API;
- грузит **слоты на месяц** через `/api/public/calendar-month`;
- **POST** `/api/public/bookings` — подтверждается мгновенно, проверяются пересечения и буферы.

Без сервера (только статика) — поведение откатывается на **mailto**.

### Admin preview на лендинге

В CRM в сайдбаре есть кнопка **«Открыть сайт как админ»** (видна admin/manager). Она открывает лендинг с `?admin=1` — после этого в углу появляется золотой бейдж `ADMIN PREVIEW · выйти`, и админу видны диагностические подсказки (типа «часть услуг скрыта, не назначены мастера»). Обычный клиент эти тексты **не** видит — они помечены `data-admin-only="1"` и скрыты CSS'ом. Подробнее — [`site-admin-preview.mjs`](./site-admin-preview.mjs).

### Обзор API

- `GET|POST /api/auth/qr-session` — создать UUID-сессию (~2 мин).
- `POST /api/auth/qr/candidates` — `{ token }` → список сотрудников для мобильного пикера.
- `POST /api/auth/qr/confirm` — `{ token, userId }` (или `user_id`).
- `GET /api/auth/qr/status?token=` — десктоп-полл; на успехе ставит **httpOnly** JWT и возвращает `{ success, user }`.
- `POST /api/auth/login` — выключен, пока не выставлен `ALLOW_PASSWORD_LOGIN=true`.
- `GET /api/auth/me` — `{ user }` или `{ user: null }`.
- `GET /api/public/*` — сотрудники, услуги, слоты, calendar-month, создание брони.
- `GET/POST/PATCH /api/crm/*` — брони, услуги, сотрудники, часы салона, FAQ (auth + role-checks).

### Что менеджер уже умеет (реализовано)

- CRUD **услуг** (имя, длительность, цена, буфер).
- CRUD **сотрудников** (active-флаг).
- **Ручные брони** в CRM, отмена через PATCH.
- **Часы салона** по дням недели (Пн–Сб в сидах); slot-движок учитывает duration + buffer + пересечения.
- **FAQ** + **?**-drawer для быстрой подсказки.

### Что дальше / Roadmap

Перенесено в [`ROADMAP.md`](./ROADMAP.md) — теперь с приоритетами и двуязычно.

### Безопасность

- Не выставлять корень репо через `express.static` — Node отдаёт только whitelist публичных файлов (см. `server/index.js`).
- В проде — сильный `JWT_SECRET` и HTTPS.

---

## 🇬🇧 English

Premium salon stack: **public site** (static HTML at repo root), **REST API** (local Node server), **online booking**, and **CRM** as a **Vite + React** app in **`work/`** (deployed on **Vercel** at **work.alessannailu.com**). The legacy **`work-crm/`** folder is an optional Next.js prototype — **not** used for production CRM hosting.

### Production hosting (domains)

| Host | What | How |
|------|------|-----|
| **https://alessannailu.com** | Marketing site (`index.html`, `styles.css`, `script.js`, …) | **GitHub Pages** via **GitHub Actions** (`.github/workflows/pages.yml`) — publishes only whitelisted static files, not the whole repo. |
| **https://work.alessannailu.com** | Staff CRM (Vite app in **`work/`**) | **Vercel** — see **`work/vercel.json`** when **Root Directory** is **`work`** (`outputDirectory`: **`dist`**). If **Root Directory** is empty, use repo-root **`vercel.json`** (`outputDirectory`: **`work/dist`**). |

**DNS (do not mix):**

- **alessannailu.com** → GitHub Pages ([GitHub's records](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)).
- **work** subdomain → Vercel (CNAME to `cname.vercel-dns.com` or as shown in your Vercel project).

**GitHub Pages setup:** Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the first run of **Deploy GitHub Pages**, set **Custom domain** to `alessannailu.com` and enable **HTTPS** (GitHub will use the **`CNAME`** file from the published artifact).

**Vercel setup (pick one):**

1. **Root Directory = `work`** (common): Vercel reads **`work/vercel.json`** — **`buildCommand`** `npm run build`, **`outputDirectory`** **`dist`**, **`framework`**: **Vite**. Do **not** use **`work/dist`** here (that path is wrong when the project root is already **`work/`**).
2. **Root Directory empty**: Repo-root **`vercel.json`** — **`cd work && …`**, **`outputDirectory`** **`work/dist`**, **`installCommand`**: **`true`** so the root `package.json` (e.g. `better-sqlite3`) is not installed on Vercel.

Env vars for CRM (Vercel → **Settings → Environment Variables**; enable for **Production** and **Preview** — Vite embeds them at **build** time):

- **`VITE_SUPABASE_URL`** — e.g. `https://eclrkusmwcrtnxqhzpky.supabase.co`
- **`VITE_SUPABASE_ANON_KEY`** — Supabase **publishable** / **anon** key (safe in the browser; protect data with **RLS**)

Local dev: copy **`work/.env.example`** → **`work/.env`** and set the key (`work/.env` is gitignored).

**Why Actions for Pages?** If you publish the **entire** repo from branch `/`, `https://alessannailu.com/work/` would expose the **Vite source** `work/index.html` (broken on static hosting). The workflow publishes only the real landing files and replaces **`/work/`** with **redirect stubs** to **work.alessannailu.com**.

Local CRM build (before push):

```bash
cd work
npm install
npm run build
```

Expect **`work/dist/index.html`** (and assets under **`work/dist/assets/`**).

### Quick start

1. Install [Node.js](https://nodejs.org/) 18+.
2. `npm install`
3. Copy `.env.example` → `.env`, set `JWT_SECRET`.
4. `npm start`
5. Open `http://localhost:3000/` — site.
   Open `http://localhost:3000/work/` — CRM (not linked from the homepage).

First run creates `data/salon.db` and seeds staff **user accounts** (used by QR picker).

### CRM login: QR only (default)

1. On a **desktop**, open `/work/` — a **QR code** appears (session ~2 min).
2. **Scan** with a phone — opens `/work/m/?token=…`.
3. **Tap your name** — desktop **polls** `/api/auth/qr/status` every **2s**, then receives an **httpOnly JWT** cookie.

No passwords on the CRM UI. Optional break-glass: set `ALLOW_PASSWORD_LOGIN=true` and use `POST /api/auth/login` (demo passwords below).

### Demo accounts (for QR mobile list)

Same users appear on the phone after scanning. For emergency password login only if `ALLOW_PASSWORD_LOGIN=true` — password **`salon2026`**:

| Role     | Email                 |
|----------|------------------------|
| Admin    | `owner@alessanna.local` |
| Manager  | `manager@alessanna.local` |
| Employee | `staff@alessanna.local` (Galina) |

### Public booking

With the server running, `script.js` detects `/api/health` and:

- loads **employees** and **services** from the API;
- loads **month slots** via `/api/public/calendar-month`;
- **POST** `/api/public/bookings` — confirmed immediately, overlap + buffer enforced.

Without the server (static files only), behaviour falls back to **mailto**.

### Admin preview on the marketing site

The CRM sidebar has an **«Open site as admin»** link (admin / manager only). It opens the landing page with `?admin=1`, after which a small gold `ADMIN PREVIEW · exit` badge appears in the corner and admin-only diagnostic notices become visible (e.g. «some services are hidden, no master assigned»). Regular clients **never** see those texts — they are tagged `data-admin-only="1"` and hidden via CSS. See [`site-admin-preview.mjs`](./site-admin-preview.mjs) for details.

### API overview

- `GET|POST /api/auth/qr-session` — create UUID session (~2 min).
- `POST /api/auth/qr/candidates` — `{ token }` → staff list for mobile picker.
- `POST /api/auth/qr/confirm` — `{ token, userId }` (or `user_id`).
- `GET /api/auth/qr/status?token=` — desktop poll; on success sets **httpOnly** JWT + returns `{ success, user }`.
- `POST /api/auth/login` — disabled unless `ALLOW_PASSWORD_LOGIN=true`.
- `GET /api/auth/me` — `{ user }` or `{ user: null }`.
- `GET /api/public/*` — employees, services, slots, calendar-month, create booking.
- `GET/POST/PATCH /api/crm/*` — bookings, services, employees, salon hours, FAQ (auth + role checks).

### Manager autonomy (implemented)

- CRUD **services** (name, duration, price, buffer).
- CRUD **employees** (active flag).
- **Manual bookings** in CRM; cancel via PATCH.
- **Salon hours** per weekday (Mon–Sat seed); slot engine uses duration + buffer + overlaps.
- **FAQ** + **?** drawer for quick help.

### Next steps (roadmap)

Moved to [`ROADMAP.md`](./ROADMAP.md) — now with priorities and bilingual.

### Security

- Do not expose the repo root with `express.static` — only whitelisted public files are served from Node (see `server/index.js`).
- Use strong `JWT_SECRET` and HTTPS in production.
