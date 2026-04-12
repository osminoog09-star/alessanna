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

## Vercel (CRM in `work/`)

The repo root **`vercel.json`** builds the **Vite** app under **`work/`** and publishes **`work/dist`**:

- **`installCommand`**: `true` — skips `npm install` at the repo root (avoids native deps like `better-sqlite3` on Vercel).
- **`buildCommand`**: `cd work && npm install && npm run build`
- **`outputDirectory`**: `work/dist` (must match Vite `outDir`; do **not** set Vercel’s UI “Output Directory” to plain `dist` unless Root Directory is `work`).
- No **`framework`** preset — the Vite preset expects `dist` at the repo root and can trigger **“No Output Directory”** / 404 when the app lives in **`work/`**.
- SPA **`rewrites`** send client routes to `index.html`.

Keep the Vercel project **root** at the **repository root** (leave **Root Directory** empty). Set **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`** in the Vercel environment for the CRM.

Local check:

```bash
cd work
npm install
npm run build
```

## Security

- Do not expose the repo root with `express.static` — only whitelisted public files are served from Node (see `server/index.js`).
- Use strong `JWT_SECRET` and HTTPS in production.
