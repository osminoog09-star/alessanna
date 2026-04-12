# Alessanna platform

Premium salon stack: **public site** (static HTML at repo root), **REST API** (local Node server), **online booking**, and **CRM** as a **Vite + React** app in **`work/`** (deployed on **Vercel** at **work.alessannailu.com**). The legacy **`work-crm/`** folder is an optional Next.js prototype — **not** used for production CRM hosting.

## Production hosting (domains)

| Host | What | How |
|------|------|-----|
| **https://alessannailu.com** | Marketing site (`index.html`, `styles.css`, `script.js`, …) | **GitHub Pages** via **GitHub Actions** (`.github/workflows/pages.yml`) — publishes only whitelisted static files, not the whole repo. |
| **https://work.alessannailu.com** | Staff CRM (Vite app in **`work/`**) | **Vercel** — see **`work/vercel.json`** when **Root Directory** is **`work`** (`outputDirectory`: **`dist`**). If **Root Directory** is empty, use repo-root **`vercel.json`** (`outputDirectory`: **`work/dist`**). |

**DNS (do not mix):**

- **alessannailu.com** → GitHub Pages ([GitHub’s records](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)).
- **work** subdomain → Vercel (CNAME to `cname.vercel-dns.com` or as shown in your Vercel project).

**GitHub Pages setup:** Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the first run of **Deploy GitHub Pages**, set **Custom domain** to `alessannailu.com` and enable **HTTPS** (GitHub will use the **`CNAME`** file from the published artifact).

**Vercel setup (pick one):**

1. **Root Directory = `work`** (common): Vercel reads **`work/vercel.json`** — **`buildCommand`** `npm run build`, **`outputDirectory`** **`dist`**, **`framework`**: **Vite**. Do **not** use **`work/dist`** here (that path is wrong when the project root is already **`work/`**).

2. **Root Directory empty**: Repo-root **`vercel.json`** — **`cd work && …`**, **`outputDirectory`** **`work/dist`**, **`installCommand`**: **`true`** so the root `package.json` (e.g. `better-sqlite3`) is not installed on Vercel.

Env vars for CRM: **`VITE_SUPABASE_URL`**, **`VITE_SUPABASE_ANON_KEY`**.

**Why Actions for Pages?** If you publish the **entire** repo from branch `/`, `https://alessannailu.com/work/` would expose the **Vite source** `work/index.html` (broken on static hosting). The workflow publishes only the real landing files and replaces **`/work/`** with **redirect stubs** to **work.alessannailu.com**.

Local CRM build (before push):

```bash
cd work
npm install
npm run build
```

Expect **`work/dist/index.html`** (and assets under **`work/dist/assets/`**).

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

## Security

- Do not expose the repo root with `express.static` — only whitelisted public files are served from Node (see `server/index.js`).
- Use strong `JWT_SECRET` and HTTPS in production.
