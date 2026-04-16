"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { init } = require("./db");
const crypto = require("crypto");
const {
  bcrypt,
  signUser,
  authMiddleware,
  requireAuth,
  requireRoles,
  setAuthCookie,
  clearAuthCookie,
  loadUserRow,
} = require("./auth");
const { getSlots, bookingEndAt, overlaps } = require("./slots");
const { sendBookingNotification } = require("./notifications");
const { normalizePhone, findUserIdByPhone, phonesMatch } = require("./phoneAuth");
const { startTelegramBot } = require("./telegramBot");

const db = init();
startTelegramBot(db);
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const root = path.join(__dirname, "..");
const { PUBLIC_LANGS, pickLocaleFromAcceptLanguage, renderPublicLandingHtml } = require("./publicSeo");

app.use(cookieParser());
app.use(express.json({ limit: "400kb" }));

if (process.env.CRM_DEV_ORIGIN) {
  app.use((req, res, next) => {
    const o = process.env.CRM_DEV_ORIGIN;
    if (req.headers.origin === o) {
      res.setHeader("Access-Control-Allow-Origin", o);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
}

app.use(authMiddleware());

function sendPublicFile(name) {
  return (_, res) => {
    res.sendFile(path.join(root, name));
  };
}

["mave.html", "mave-ru.html", "work.html", "work.css", "work.js", "styles.css", "script.js", "translations.js"].forEach(
  (name) => {
    app.get("/" + name, sendPublicFile(name));
  }
);

app.get("/locales/:file", (req, res, next) => {
  const m = /^([a-z]{2})\.json$/i.exec(req.params.file || "");
  if (!m || !["ru", "et", "fi", "en"].includes(m[1].toLowerCase())) return next();
  const lng = m[1].toLowerCase();
  const fp = path.join(root, "locales", `${lng}.json`);
  if (!fs.existsSync(fp)) return next();
  res.type("application/json").sendFile(fp);
});

/** Localized landing: SEO title/description, hreflang, canonical, lang switcher */
PUBLIC_LANGS.forEach((lng) => {
  app.get(`/${lng}`, (req, res) => {
    res.type("html").send(renderPublicLandingHtml(root, req, lng));
  });
});

app.get("/", (req, res) => {
  const target = pickLocaleFromAcceptLanguage(req.headers["accept-language"]);
  res.redirect(302, `/${target}`);
});

app.get("/index.html", (_, res) => res.redirect(302, "/et"));
app.get("/ru.html", (_, res) => res.redirect(302, "/ru"));

app.get("/api/health", (_, res) => res.json({ ok: true }));

/* ------------------------- Public API ------------------------- */
function listPublicEmployees(serviceId) {
  const rows = db.prepare("SELECT id, name, slug FROM employees WHERE active = 1 ORDER BY id").all();
  const sid = Number(serviceId);
  if (!sid || Number.isNaN(sid)) return rows;
  const forSvc = db.prepare("SELECT employee_id FROM employee_services WHERE service_id = ?").all(sid);
  if (!forSvc.length) return rows;
  const ids = new Set(forSvc.map((r) => r.employee_id));
  return rows.filter((e) => ids.has(e.id));
}

/** Same rule as listPublicEmployees: if no rows for this service, any active employee; else must be linked. */
function employeeAllowedForService(employeeId, serviceId) {
  const forSvc = db.prepare("SELECT employee_id FROM employee_services WHERE service_id = ?").all(serviceId);
  if (!forSvc.length) return true;
  return forSvc.some((r) => r.employee_id === employeeId);
}

function serviceIdsForEmployee(employeeId) {
  return db
    .prepare("SELECT service_id FROM employee_services WHERE employee_id = ? ORDER BY service_id")
    .all(employeeId)
    .map((r) => r.service_id);
}

function attachServiceIds(row) {
  return row ? { ...row, serviceIds: serviceIdsForEmployee(row.id) } : row;
}

function replaceEmployeeServices(employeeId, serviceIds) {
  if (!Array.isArray(serviceIds)) return;
  const normalized = [...new Set(serviceIds.map(Number).filter((id) => id > 0))];
  const del = db.prepare("DELETE FROM employee_services WHERE employee_id = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO employee_services (employee_id, service_id) VALUES (?, ?)");
  const run = db.transaction(() => {
    del.run(employeeId);
    for (const serviceId of normalized) ins.run(employeeId, serviceId);
  });
  run();
}

function uniqueSortedSlots(slots) {
  return [...new Set(slots)].sort();
}

function slotsForAnyEmployee(serviceId, dateStr) {
  const employees = listPublicEmployees(serviceId);
  const allSlots = [];
  for (const employee of employees) {
    allSlots.push(...getSlots(db, { employeeId: employee.id, dateStr, serviceId }));
  }
  return uniqueSortedSlots(allSlots);
}

function findEmployeeForSlot(serviceId, dateStr, time) {
  const employees = listPublicEmployees(serviceId);
  for (const employee of employees) {
    const slots = getSlots(db, { employeeId: employee.id, dateStr, serviceId });
    if (slots.includes(time)) return employee;
  }
  return null;
}

app.get("/api/public/employees", (req, res) => {
  res.json(listPublicEmployees(req.query.serviceId));
});

app.get("/api/public/employee-services", (_, res) => {
  const rows = db.prepare("SELECT employee_id, service_id FROM employee_services").all();
  res.json(rows);
});

app.get("/api/public/services", (_, res) => {
  const rows = db
    .prepare(
      "SELECT id, slug, name_et, name_en, duration_min, buffer_after_min, price_cents FROM services WHERE active = 1 ORDER BY sort_order, id"
    )
    .all();
  res.json(rows);
});

app.get("/api/public/slots", (req, res) => {
  const anyEmployee = req.query.employeeId === "any";
  const employeeId = Number(req.query.employeeId);
  const date = req.query.date;
  const serviceId = Number(req.query.serviceId);
  if ((!employeeId && !anyEmployee) || !date || !serviceId) {
    return res.status(400).json({ error: "employeeId, date, serviceId required" });
  }
  if (anyEmployee) return res.json({ slots: slotsForAnyEmployee(serviceId, date) });
  const emp = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const slots = getSlots(db, { employeeId, dateStr: date, serviceId });
  res.json({ slots });
});

/** Один запрос на месяц — без десятков отдельных вызовов с клиента */
app.get("/api/public/calendar-month", (req, res) => {
  const anyEmployee = req.query.employeeId === "any";
  const employeeId = Number(req.query.employeeId);
  const serviceId = Number(req.query.serviceId);
  const y = Number(req.query.y);
  const m = Number(req.query.m);
  if ((!employeeId && !anyEmployee) || !serviceId || Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11) {
    return res.status(400).json({ error: "employeeId, serviceId, y, m (0-11) required" });
  }
  if (!anyEmployee) {
    const emp = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
  }

  const dim = new Date(y, m + 1, 0).getDate();
  const days = {};
  for (let d = 1; d <= dim; d++) {
    const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const slots = anyEmployee ? slotsForAnyEmployee(serviceId, key) : getSlots(db, { employeeId, dateStr: key, serviceId });
    days[key] = { slots };
  }
  res.json({ days });
});

app.post("/api/public/bookings", (req, res) => {
  const b = req.body || {};
  let employeeId = Number(b.employeeId);
  const anyEmployee = b.employeeId === "any";
  const serviceId = Number(b.serviceId);
  const date = b.date;
  const time = b.time;
  const clientName = (b.clientName || b.name || "").trim();
  if ((!employeeId && !anyEmployee) || !serviceId || !date || !time || !clientName) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!service) return res.status(400).json({ error: "Invalid service" });

  if (anyEmployee) {
    const employee = findEmployeeForSlot(serviceId, date, time);
    if (!employee) return res.status(409).json({ error: "Invalid slot" });
    employeeId = employee.id;
  }

  const empRow = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!empRow) return res.status(400).json({ error: "Invalid employee" });
  if (!employeeAllowedForService(employeeId, serviceId)) {
    return res.status(400).json({ error: "Employee does not provide this service" });
  }

  const { startAt, endAt } = bookingEndAt(date, time, service.duration_min, service.buffer_after_min);

  const existing = db
    .prepare(
      `SELECT start_at, end_at FROM bookings WHERE employee_id = ? AND status != 'cancelled' AND substr(start_at,1,10) = ?`
    )
    .all(employeeId, date);
  for (const row of existing) {
    if (overlaps(startAt, endAt, row.start_at, row.end_at)) {
      return res.status(409).json({ error: "Time no longer available" });
    }
  }

  const slots = getSlots(db, { employeeId, dateStr: date, serviceId });
  if (!slots.includes(time)) {
    return res.status(409).json({ error: "Invalid slot" });
  }

  const info = db
    .prepare(
      `INSERT INTO bookings (service_id, employee_id, client_name, client_phone, client_email, start_at, end_at, status, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'online', ?)`
    )
    .run(
      serviceId,
      employeeId,
      clientName,
      (b.clientPhone || b.phone || "").trim() || null,
      (b.clientEmail || b.email || "").trim() || null,
      startAt,
      endAt,
      (b.notes || "").trim() || null
    );

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
  sendBookingNotification(booking, "confirmed").catch(() => {});

  res.status(201).json({ booking });
});

/* ------------------------- Auth: QR (primary) ------------------------- */
const QR_SESSION_MS = Number(process.env.QR_SESSION_MS) || 120000;

function cleanupQrSessions() {
  db.prepare("DELETE FROM qr_sessions WHERE expires_at < ?").run(Date.now());
}

function createQrSession(req, res) {
  cleanupQrSessions();
  const token = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO qr_sessions (token, status, expires_at, created_at) VALUES (?, 'pending', ?, ?)"
  ).run(token, now + QR_SESSION_MS, now);
  const scanBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  const telegramUrl =
    botUsername && process.env.TELEGRAM_BOT_TOKEN
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(token)}`
      : null;
  res.json({
    token,
    expiresInMs: QR_SESSION_MS,
    scanBase: scanBase || null,
    telegramUrl,
  });
}

/** Desktop: new QR session (GET and POST — avoid proxy caching on GET) */
app.get("/api/auth/qr-session", createQrSession);
app.post("/api/auth/qr-session", createQrSession);

/** Mobile: list staff who may confirm — only with valid pending session token */
app.post("/api/auth/qr/candidates", (req, res) => {
  const token = (req.body && req.body.token) || "";
  if (!token) return res.status(400).json({ error: "token required" });
  const row = db.prepare("SELECT * FROM qr_sessions WHERE token = ?").get(token);
  if (!row || row.status !== "pending" || row.expires_at < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired session" });
  }
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.role, e.name AS employee_name
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.email`
    )
    .all();
  const list = users.map((u) => ({
    id: u.id,
    label: u.employee_name ? u.employee_name + " · " + u.email : u.email,
    role: u.role,
  }));
  res.json({ users: list });
});

/** Mobile: confirm who is logging in on desktop (legacy pick-list; prefer qr/verify-phone) */
app.post("/api/auth/qr/confirm", (req, res) => {
  const body = req.body || {};
  const token = body.token;
  const userId = body.userId != null ? body.userId : body.user_id;
  if (!token || userId == null) return res.status(400).json({ error: "token and userId required" });
  const row = db.prepare("SELECT * FROM qr_sessions WHERE token = ?").get(token);
  if (!row || row.expires_at < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired" });
  }
  if (row.status !== "pending") {
    return res.status(400).json({ error: "Session already used" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(Number(userId));
  if (!user) return res.status(400).json({ error: "Invalid user" });
  db.prepare("UPDATE qr_sessions SET status = 'confirmed', user_id = ? WHERE token = ?").run(user.id, token);
  res.json({ ok: true });
});

/** Mobile: enter phone after scan — matches admin (env) or staff user linked to employee.phone */
app.post("/api/auth/qr/verify-phone", (req, res) => {
  const body = req.body || {};
  const token = body.token;
  const phone = body.phone;
  if (!token || !phone) return res.status(400).json({ error: "token and phone required" });
  const row = db.prepare("SELECT * FROM qr_sessions WHERE token = ?").get(token);
  if (!row || row.expires_at < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired session" });
  }
  if (row.status !== "pending") {
    return res.status(400).json({ error: "Session already used" });
  }
  const digits = normalizePhone(phone);
  const userId = findUserIdByPhone(db, digits);
  if (!userId) {
    return res.status(401).json({ error: "Phone not recognized" });
  }
  db.prepare("UPDATE qr_sessions SET status = 'confirmed', user_id = ? WHERE token = ?").run(userId, token);
  res.json({ ok: true });
});

/** Admin break-glass: email + phone must match ADMIN_EMAIL / ADMIN_PHONE (no QR). */
app.post("/api/auth/admin-direct", (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const phone = normalizePhone(body.phone || "");
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE || "");
  if (!adminEmail || !adminPhone) {
    return res.status(503).json({ error: "Admin direct login not configured (ADMIN_EMAIL / ADMIN_PHONE)" });
  }
  if (!email || !phone) return res.status(400).json({ error: "email and phone required" });
  if (email !== adminEmail || !phonesMatch(adminPhone, phone)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const user = db.prepare("SELECT * FROM users WHERE lower(email) = ? AND role = 'admin'").get(adminEmail);
  if (!user) return res.status(401).json({ error: "Admin account missing — check database" });
  const jwtTok = signUser(user);
  setAuthCookie(res, jwtTok);
  res.json({
    accessToken: jwtTok,
    user: { id: user.id, email: user.email, role: user.role, employeeId: user.employee_id },
  });
});

/** Desktop: poll every ~2s — on success sets httpOnly JWT cookie */
app.get("/api/auth/qr/status", (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== "string") {
    return res.json({ success: false });
  }
  const row = db.prepare("SELECT * FROM qr_sessions WHERE token = ?").get(token);
  if (!row) {
    return res.json({ success: false, error: "unknown_token" });
  }
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM qr_sessions WHERE token = ?").run(token);
    return res.json({ success: false, error: "expired" });
  }
  if (row.status === "confirmed" && row.user_id) {
    const user = db
      .prepare(
        `SELECT u.*, e.name AS employee_name
         FROM users u
         LEFT JOIN employees e ON e.id = u.employee_id
         WHERE u.id = ?`
      )
      .get(row.user_id);
    if (!user) {
      db.prepare("DELETE FROM qr_sessions WHERE token = ?").run(token);
      return res.json({ success: false, error: "user_missing" });
    }
    const jwtTok = signUser(user);
    setAuthCookie(res, jwtTok);
    db.prepare("DELETE FROM qr_sessions WHERE token = ?").run(token);
    const displayName =
      user.employee_name || (user.email && user.email.split("@")[0]) || user.email || "User";
    return res.json({
      success: true,
      accessToken: jwtTok,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employee_id,
        name: displayName,
      },
    });
  }
  res.json({ success: false });
});

/* ------------------------- Auth: password (emergency only) ------------------------- */
app.post("/api/auth/login", (req, res) => {
  if (process.env.ALLOW_PASSWORD_LOGIN !== "true") {
    return res.status(403).json({ error: "Password login disabled. Use QR on /work." });
  }
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signUser(user);
  setAuthCookie(res, token);
  res.json({
    accessToken: token,
    user: { id: user.id, email: user.email, role: user.role, employeeId: user.employee_id },
  });
});

app.post("/api/auth/logout", (_, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user || !req.user.sub) return res.json({ user: null });
  const user = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.employee_id, e.name AS employee_name
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE u.id = ?`
    )
    .get(Number(req.user.sub));
  if (!user) return res.json({ user: null });
  const name =
    user.employee_name || (user.email && user.email.split("@")[0]) || user.email || "User";
  res.json({
    user: { id: user.id, email: user.email, role: user.role, employeeId: user.employee_id, name },
  });
});

/* ------------------------- CRM: FAQ ------------------------- */
const FAQ = [
  {
    id: "qr-login",
    title: "Login: QR → Telegram (staff)",
    body: "On /work/login the QR encodes https://t.me/YOUR_BOT?start=TOKEN. Scan with the phone camera, open Telegram, tap Start. The bot links your Telegram ID to a users.telegram_id row and approves the session; the desktop polls /api/auth/qr/status. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME. Legacy web/phone flows remain in the API if needed.",
  },
  {
    id: "qr-mobile",
    title: "Telegram: link account",
    body: "Admins set telegram_id per user via PATCH /api/crm/users/:id/telegram. Without a linked Telegram ID, the bot replies Access denied. Get your numeric Telegram ID from @userinfobot.",
  },
  {
    id: "admin-direct",
    title: "Admin: direct login",
    body: "On /work/login, use Admin access with the email and phone set in ADMIN_EMAIL and ADMIN_PHONE. No QR required. Keep these values secret.",
  },
  {
    id: "emp-add",
    title: "Employees: add or remove",
    body: "Open Employees → Add: enter name, phone, optional email, Save. To deactivate, toggle Active off (history stays). Only Manager and Admin.",
  },
  {
    id: "emp-roles",
    title: "Employees: assign roles",
    body: "Staff sign in via QR (no passwords on desktop). User accounts (admin / manager / employee) live in the database — add rows or extend UI to link new employees to users. Optional break-glass: set ALLOW_PASSWORD_LOGIN=true in .env for legacy email/password API only.",
  },
  {
    id: "svc-create",
    title: "Services: create",
    body: "Services → Add service: name, duration, buffer after visit, price. Clients see active services on the public booking flow.",
  },
  {
    id: "svc-price",
    title: "Services: change price",
    body: "Services → click Edit on a row, update price (cents in API; UI shows euros), Save.",
  },
  {
    id: "book-create",
    title: "Bookings: create manually",
    body: "Bookings → New booking: pick employee, service, date, time (only free slots). Source is “manual”. Client phone helps with reminders later.",
  },
  {
    id: "book-resched",
    title: "Bookings: reschedule",
    body: "Bookings → select booking → Reschedule: choose new slot; system checks overlaps and buffers.",
  },
  {
    id: "book-cancel",
    title: "Bookings: cancel",
    body: "Bookings → Cancel: status becomes cancelled; slot frees up immediately.",
  },
  {
    id: "sched-hours",
    title: "Schedule: working hours",
    body: "Settings → Salon hours: set open/close per weekday (Mon–Sat by default). Slot generator uses these windows + service duration + buffer.",
  },
  {
    id: "sched-days",
    title: "Schedule: closed days",
    body: "Sunday has no row in salon hours → closed. To close another weekday, remove or zero that row (extend UI as needed).",
  },
];

app.get("/api/crm/faq", requireAuth, (_, res) => res.json({ items: FAQ }));

/* ------------------------- CRM: bookings ------------------------- */
app.get("/api/crm/bookings", requireAuth, (req, res) => {
  const from = req.query.from || "";
  const to = req.query.to || "";
  let sql = `SELECT b.*, s.name_et AS service_name, e.name AS employee_name
             FROM bookings b
             JOIN services s ON s.id = b.service_id
             JOIN employees e ON e.id = b.employee_id
             WHERE 1=1`;
  const params = [];
  if (req.user.role === "employee") {
    sql += " AND b.employee_id = ?";
    params.push(req.user.employeeId);
  }
  if (from) {
    sql += " AND b.start_at >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND b.start_at <= ?";
    params.push(to);
  }
  sql += " ORDER BY b.start_at ASC";
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.post("/api/crm/bookings", requireAuth, requireRoles("admin", "manager", "employee"), (req, res) => {
  const b = req.body || {};
  const employeeId = Number(b.employeeId);
  const serviceId = Number(b.serviceId);
  const date = b.date;
  const time = b.time;
  const clientName = (b.clientName || "").trim();
  if (!employeeId || !serviceId || !date || !time || !clientName) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (req.user.role === "employee" && Number(req.user.employeeId) !== employeeId) {
    return res.status(403).json({ error: "Can only book for yourself" });
  }

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!service) return res.status(400).json({ error: "Invalid service" });

  const empCrm = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!empCrm) return res.status(400).json({ error: "Invalid employee" });
  if (!employeeAllowedForService(employeeId, serviceId)) {
    return res.status(400).json({ error: "Employee does not provide this service" });
  }

  const { startAt, endAt } = bookingEndAt(date, time, service.duration_min, service.buffer_after_min);
  const existing = db
    .prepare(
      `SELECT start_at, end_at FROM bookings WHERE employee_id = ? AND status != 'cancelled' AND substr(start_at,1,10) = ?`
    )
    .all(employeeId, date);
  for (const row of existing) {
    if (overlaps(startAt, endAt, row.start_at, row.end_at)) {
      return res.status(409).json({ error: "Overlap" });
    }
  }

  const slots = getSlots(db, { employeeId, dateStr: date, serviceId });
  if (!slots.includes(time)) return res.status(409).json({ error: "Invalid slot" });

  const info = db
    .prepare(
      `INSERT INTO bookings (service_id, employee_id, client_name, client_phone, client_email, start_at, end_at, status, source, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'manual', ?, ?)`
    )
    .run(
      serviceId,
      employeeId,
      clientName,
      (b.clientPhone || "").trim() || null,
      (b.clientEmail || "").trim() || null,
      startAt,
      endAt,
      (b.notes || "").trim() || null,
      req.user.sub
    );

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
  sendBookingNotification(booking, "manual_created").catch(() => {});
  res.status(201).json({ booking });
});

app.patch("/api/crm/bookings/:id", requireAuth, requireRoles("admin", "manager", "employee"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (req.user.role === "employee" && Number(row.employee_id) !== Number(req.user.employeeId)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const patch = req.body || {};
  if (patch.status === "cancelled") {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id);
    sendBookingNotification({ ...row, status: "cancelled" }, "cancelled").catch(() => {});
    return res.json({ ok: true });
  }

  if (patch.date && patch.time && patch.employeeId && patch.serviceId) {
    const employeeId = Number(patch.employeeId);
    const serviceId = Number(patch.serviceId);
    const service = db.prepare("SELECT * FROM services WHERE id = ?").get(serviceId);
    if (!service) return res.status(400).json({ error: "Invalid service" });
    const empPatch = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
    if (!empPatch) return res.status(400).json({ error: "Invalid employee" });
    if (!employeeAllowedForService(employeeId, serviceId)) {
      return res.status(400).json({ error: "Employee does not provide this service" });
    }
    const { startAt, endAt } = bookingEndAt(patch.date, patch.time, service.duration_min, service.buffer_after_min);

    const existing = db
      .prepare(
        `SELECT start_at, end_at FROM bookings WHERE employee_id = ? AND status != 'cancelled' AND id != ? AND substr(start_at,1,10) = ?`
      )
      .all(employeeId, id, patch.date);
    for (const ex of existing) {
      if (overlaps(startAt, endAt, ex.start_at, ex.end_at)) {
        return res.status(409).json({ error: "Overlap" });
      }
    }

    db.prepare(
      "UPDATE bookings SET employee_id = ?, service_id = ?, start_at = ?, end_at = ?, status = 'confirmed' WHERE id = ?"
    ).run(employeeId, serviceId, startAt, endAt, id);
    const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
    sendBookingNotification(booking, "rescheduled").catch(() => {});
    return res.json({ booking });
  }

  res.status(400).json({ error: "Unsupported patch" });
});

/* ------------------------- CRM: services ------------------------- */
app.get("/api/crm/services", requireAuth, (req, res) => {
  if (req.user.role === "employee") {
    const rows = db
      .prepare("SELECT id, slug, name_et, duration_min, buffer_after_min, price_cents, active FROM services WHERE active = 1 ORDER BY sort_order")
      .all();
    return res.json(rows);
  }
  const rows = db.prepare("SELECT * FROM services ORDER BY sort_order, id").all();
  res.json(rows);
});

app.post("/api/crm/services", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const s = req.body || {};
  const info = db
    .prepare(
      `INSERT INTO services (slug, name_et, name_en, duration_min, buffer_after_min, price_cents, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      (s.slug || "").trim() || null,
      (s.name_et || s.name || "").trim(),
      (s.name_en || "").trim() || null,
      Number(s.duration_min) || 60,
      Number(s.buffer_after_min) || 10,
      Number(s.price_cents) || 0,
      s.active === false ? 0 : 1,
      Number(s.sort_order) || 0
    );
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch("/api/crm/services/:id", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const s = req.body || {};
  db.prepare(
    `UPDATE services SET
      slug = COALESCE(?, slug),
      name_et = COALESCE(?, name_et),
      name_en = COALESCE(?, name_en),
      duration_min = COALESCE(?, duration_min),
      buffer_after_min = COALESCE(?, buffer_after_min),
      price_cents = COALESCE(?, price_cents),
      active = COALESCE(?, active),
      sort_order = COALESCE(?, sort_order)
     WHERE id = ?`
  ).run(
    s.slug !== undefined ? s.slug : null,
    s.name_et !== undefined ? s.name_et : null,
    s.name_en !== undefined ? s.name_en : null,
    s.duration_min !== undefined ? s.duration_min : null,
    s.buffer_after_min !== undefined ? s.buffer_after_min : null,
    s.price_cents !== undefined ? s.price_cents : null,
    s.active !== undefined ? (s.active ? 1 : 0) : null,
    s.sort_order !== undefined ? s.sort_order : null,
    id
  );
  res.json({ ok: true });
});

app.delete("/api/crm/services/:id", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  db.prepare("UPDATE services SET active = 0 WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

/* ------------------------- CRM: employees ------------------------- */
app.get("/api/crm/employees", requireAuth, (req, res) => {
  if (req.user.role === "employee") {
    const one = db
      .prepare("SELECT id, name, phone, email, active FROM employees WHERE id = ?")
      .get(Number(req.user.employeeId));
    return res.json(one ? [attachServiceIds(one)] : []);
  }
  const rows = db.prepare("SELECT * FROM employees ORDER BY id").all();
  res.json(rows.map(attachServiceIds));
});

app.post("/api/crm/employees", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const e = req.body || {};
  const info = db
    .prepare("INSERT INTO employees (name, phone, email, slug, active) VALUES (?, ?, ?, ?, 1)")
    .run((e.name || "").trim(), (e.phone || "").trim() || null, (e.email || "").trim() || null, (e.slug || "").trim() || null);
  replaceEmployeeServices(info.lastInsertRowid, e.serviceIds);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch("/api/crm/employees/:id", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  const e = req.body || {};
  db.prepare(
    `UPDATE employees SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      slug = COALESCE(?, slug),
      active = COALESCE(?, active)
     WHERE id = ?`
  ).run(
    e.name !== undefined ? e.name : null,
    e.phone !== undefined ? e.phone : null,
    e.email !== undefined ? e.email : null,
    e.slug !== undefined ? e.slug : null,
    e.active !== undefined ? (e.active ? 1 : 0) : null,
    id
  );
  replaceEmployeeServices(id, e.serviceIds);
  res.json({ ok: true });
});

/** Link Telegram numeric ID to a user (admin). Get your ID from @userinfobot or bot logs. */
app.patch("/api/crm/users/:id/telegram", requireAuth, requireRoles("admin"), (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const raw = body.telegramId !== undefined ? body.telegramId : body.telegram_id;
  let telegramId;
  if (raw === null || raw === "" || body.clear === true) {
    telegramId = null;
  } else if (raw !== undefined) {
    telegramId = Number(raw);
    if (Number.isNaN(telegramId) || telegramId <= 0) {
      return res.status(400).json({ error: "Invalid telegramId" });
    }
  } else {
    return res.status(400).json({ error: "telegramId or clear required" });
  }
  const row = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "User not found" });
  if (telegramId != null) {
    const taken = db.prepare("SELECT id FROM users WHERE telegram_id = ? AND id != ?").get(telegramId, id);
    if (taken) return res.status(409).json({ error: "telegram_id already linked to another user" });
  }
  db.prepare("UPDATE users SET telegram_id = ? WHERE id = ?").run(telegramId, id);
  res.json({ ok: true });
});

/* ------------------------- CRM: salon hours ------------------------- */
app.get("/api/crm/salon-hours", requireAuth, requireRoles("admin", "manager", "employee"), (_, res) => {
  const rows = db.prepare("SELECT * FROM salon_hours ORDER BY weekday").all();
  res.json(rows);
});

app.put("/api/crm/salon-hours", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: "Expected array" });
  const del = db.prepare("DELETE FROM salon_hours");
  const ins = db.prepare("INSERT INTO salon_hours (weekday, open_min, close_min) VALUES (?, ?, ?)");
  const run = db.transaction(() => {
    del.run();
    for (const h of list) {
      ins.run(Number(h.weekday), Number(h.open_min), Number(h.close_min));
    }
  });
  run();
  res.json({ ok: true });
});

/* ------------------------- CRM: stats ------------------------- */
app.get("/api/crm/stats", requireAuth, requireRoles("admin", "manager"), (_, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const bookingsToday = db
    .prepare(
      `SELECT COUNT(*) AS c FROM bookings WHERE status != 'cancelled' AND substr(start_at,1,10) = ?`
    )
    .get(today).c;
  const upcoming = db.prepare(`SELECT COUNT(*) AS c FROM bookings WHERE status = 'confirmed' AND start_at >= datetime('now')`).get()
    .c;
  const employees = db.prepare("SELECT COUNT(*) AS c FROM employees WHERE active = 1").get().c;
  const services = db.prepare("SELECT COUNT(*) AS c FROM services WHERE active = 1").get().c;
  const revenueTodayCents = db
    .prepare(
      `SELECT COALESCE(SUM(s.price_cents), 0) AS c
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.status != 'cancelled' AND substr(b.start_at,1,10) = ?`
    )
    .get(today).c;
  const revenueMonthCents = db
    .prepare(
      `SELECT COALESCE(SUM(s.price_cents), 0) AS c
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.status != 'cancelled' AND substr(b.start_at,1,7) = ?`
    )
    .get(monthPrefix).c;
  res.json({ bookingsToday, upcoming, employees, services, revenueTodayCents, revenueMonthCents });
});

app.get("/api/crm/analytics", requireAuth, requireRoles("admin", "manager"), (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 366);
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const byEmployee = db
    .prepare(
      `SELECT e.id AS employee_id, e.name AS employee_name,
              COUNT(b.id) AS booking_count,
              COALESCE(SUM(s.price_cents), 0) AS revenue_cents
       FROM employees e
       LEFT JOIN bookings b ON b.employee_id = e.id AND b.status != 'cancelled' AND substr(b.start_at,1,10) >= ?
       LEFT JOIN services s ON s.id = b.service_id
       GROUP BY e.id
       ORDER BY revenue_cents DESC`
    )
    .all(sinceStr);

  const byService = db
    .prepare(
      `SELECT s.id AS service_id, s.name_et AS name, COUNT(b.id) AS booking_count,
              COALESCE(SUM(s.price_cents), 0) AS revenue_cents
       FROM services s
       LEFT JOIN bookings b ON b.service_id = s.id AND b.status != 'cancelled' AND substr(b.start_at,1,10) >= ?
       GROUP BY s.id
       ORDER BY booking_count DESC`
    )
    .all(sinceStr);

  const byDay = db
    .prepare(
      `SELECT substr(b.start_at,1,10) AS day, COUNT(*) AS c
       FROM bookings b
       WHERE b.status != 'cancelled' AND substr(b.start_at,1,10) >= ?
       GROUP BY substr(b.start_at,1,10)
       ORDER BY day ASC`
    )
    .all(sinceStr);

  res.json({ periodDays: days, since: sinceStr, byEmployee, byService, byDay });
});

app.post("/api/payments/create-checkout-session", requireAuth, requireRoles("admin", "manager"), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(501).json({ error: "Stripe not configured (STRIPE_SECRET_KEY)" });
  }
  let Stripe;
  try {
    Stripe = require("stripe");
  } catch {
    return res.status(501).json({ error: 'Install dependency: npm install stripe' });
  }
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { bookingId, successUrl, cancelUrl } = req.body || {};
    const b = bookingId ? db.prepare("SELECT * FROM bookings WHERE id = ?").get(Number(bookingId)) : null;
    const lineName = b ? `Booking #${b.id}` : "Salon payment";
    const amount = Number(req.body.amountCents) || 3500;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl || `${req.protocol}://${req.get("host")}/work/bookings/?paid=1`,
      cancel_url: cancelUrl || `${req.protocol}://${req.get("host")}/work/bookings/?paid=0`,
      line_items: [
        { price_data: { currency: "eur", product_data: { name: lineName }, unit_amount: amount }, quantity: 1 },
      ],
      metadata: bookingId ? { booking_id: String(bookingId) } : {},
    });
    res.json({ url: session.url, id: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message || "Stripe error" });
  }
});

/* ------------------------- /work — Vite CRM dist > Next export > work/ static ------------------------- */
const viteCrmDist = path.join(root, "work", "dist");
const crmNextOut = path.join(root, "work-crm", "out", "work");
app.get("/work", (_, res) => res.redirect(302, "/work/"));
if (fs.existsSync(viteCrmDist)) {
  app.use("/work", express.static(viteCrmDist));
  app.use("/work", (_, res) => {
    res.sendFile(path.join(viteCrmDist, "index.html"));
  });
} else if (fs.existsSync(crmNextOut)) {
  app.get(["/work/login", "/work/login/"], (_, res) => res.redirect(302, "/work/"));
  app.use(
    "/work",
    express.static(crmNextOut, {
      index: "index.html",
    })
  );
} else {
  app.use(
    "/work",
    express.static(path.join(root, "work"), {
      index: "index.html",
    })
  );
}

app.get("/book.html", (_, res) => {
  res.sendFile(path.join(root, "public-site", "book.html"));
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.status(404).send("Not found");
});

const { startReminderLoop } = require("./reminders");
startReminderLoop();

app.listen(PORT, () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`Alessanna dev http://localhost:${PORT} (API + site; CRM — отдельный Vite/Vercel)`);
  } else {
    console.log(`Alessanna listening on :${PORT}`);
  }
});
