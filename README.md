# Alessanna platform

Premium salon stack: **public site** (existing HTML), **REST API**, **online booking** (auto-confirmed), **CRM** at **`/work`** (no public links), roles, SQLite DB, FAQ inside CRM. **Telegram / WhatsApp / Google Calendar** are stubbed — wire env vars when ready (see `server/notifications.js`, `server/googleCalendar.js`).

## Quick start

1. Install [Node.js](https://nodejs.org/) 18+.
2. `npm install`
3. Copy `.env.example` → `.env`, set `JWT_SECRET`.
4. `npm start`
5. Open `http://localhost:3000/` — site.  
   Open `http://localhost:3000/work/` — CRM (not linked from the homepage).

First run creates `data/salon.db` and seeds staff **user accounts** (used by QR picker).

## CRM login: QR only (default)

1. On a **desktop**, open `/work/` — a **QR code** appears (session ~2 min).
2. **Scan** with a phone — opens `/work/m/?token=…`.
3. **Tap your name** — desktop **polls** `/api/auth/qr/status` every **2s**, then receives an **httpOnly JWT** cookie.

No passwords on the CRM UI. Optional break-glass: set `ALLOW_PASSWORD_LOGIN=true` and use `POST /api/auth/login` (demo passwords below).

## Demo accounts (for QR mobile list)

Same users appear on the phone after scanning. For emergency password login only if `ALLOW_PASSWORD_LOGIN=true` — password **`salon2026`**:

| Role     | Email                 |
|----------|------------------------|
| Admin    | `owner@alessanna.local` |
| Manager  | `manager@alessanna.local` |
| Employee | `staff@alessanna.local` (Galina) |

## Public booking

With the server running, `script.js` detects `/api/health` and:

- loads **employees** and **services** from the API;
- loads **month slots** via `/api/public/calendar-month`;
- **POST** `/api/public/bookings` — confirmed immediately, overlap + buffer enforced.

Without the server (static files only), behaviour falls back to **mailto**.

## API overview

- `GET|POST /api/auth/qr-session` — create UUID session (~2 min).
- `POST /api/auth/qr/candidates` — `{ token }` → staff list for mobile picker.
- `POST /api/auth/qr/confirm` — `{ token, userId }` (or `user_id`).
- `GET /api/auth/qr/status?token=` — desktop poll; on success sets **httpOnly** JWT + returns `{ success, user }`.
- `POST /api/auth/login` — disabled unless `ALLOW_PASSWORD_LOGIN=true`.
- `GET /api/auth/me` — `{ user }` or `{ user: null }`.
- `GET /api/public/*` — employees, services, slots, calendar-month, create booking.
- `GET/POST/PATCH /api/crm/*` — bookings, services, employees, salon hours, FAQ (auth + role checks).

## Manager autonomy (implemented)

- CRUD **services** (name, duration, price, buffer).
- CRUD **employees** (active flag).
- **Manual bookings** in CRM; cancel via PATCH.
- **Salon hours** per weekday (Mon–Sat seed); slot engine uses duration + buffer + overlaps.
- **FAQ** + **?** drawer for quick help.

## Next steps (your roadmap)

- Reschedule UI (API already supports PATCH with `date`, `time`, `employeeId`, `serviceId`).
- User admin UI (create logins per employee; today via DB/API).
- Google OAuth + Calendar push; Telegram/WhatsApp send on booking events.
- Payments, analytics, loyalty (new modules + tables).

## Deployment (production)

- **GitHub Pages** — hosts the **public static site** at the **repository root** (`index.html`, `styles.css`, `script.js`, assets). Enable Pages on the `main` branch from `/` (root). A **`.nojekyll`** file is included so Jekyll does not strip files that start with `_`.
- **Vercel** — deploy **only** the **Vite CRM** in **`work/`**:
  1. Import this repo in Vercel.
  2. Set **Root Directory** to **`work`** (required).
  3. Framework preset **Vite**; **Build Command** `npm run build`; **Output Directory** `dist` (matches `work/vercel.json`).
  Do **not** attach Vercel to the repo root without that setting — the root is the static marketing site, not the SPA build.
- **`work-crm/`** — optional **Next.js** prototype / alternate stack; it is **not** the production CRM on Vercel. Production CRM is **`work/`**.

## Security

- Do not expose the repo root with `express.static` — only whitelisted public files are served from Node (see `server/index.js`).
- Use strong `JWT_SECRET` and HTTPS in production.
