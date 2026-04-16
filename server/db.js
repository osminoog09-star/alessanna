"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "salon.db");

function open() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      slug TEXT UNIQUE,
      google_refresh_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
      employee_id INTEGER REFERENCES employees(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE,
      name_et TEXT NOT NULL,
      name_en TEXT,
      duration_min INTEGER NOT NULL DEFAULT 60,
      buffer_after_min INTEGER NOT NULL DEFAULT 10,
      price_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS salon_hours (
      weekday INTEGER NOT NULL,
      open_min INTEGER NOT NULL,
      close_min INTEGER NOT NULL,
      PRIMARY KEY (weekday)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL REFERENCES services(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      client_name TEXT NOT NULL,
      client_phone TEXT,
      client_email TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'manual')),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_employee_start ON bookings(employee_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

    CREATE TABLE IF NOT EXISTS qr_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_qr_sessions_token ON qr_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_qr_sessions_expires ON qr_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS employee_services (
      employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      PRIMARY KEY (employee_id, service_id)
    );
  `);

  const empCols = db.prepare("PRAGMA table_info(employees)").all();
  if (!empCols.some((c) => c.name === "roles")) {
    try {
      db.exec("ALTER TABLE employees ADD COLUMN roles TEXT");
    } catch (e) {
      /* ignore */
    }
  }
  db.prepare(
    `UPDATE employees SET roles = '["employee"]' WHERE roles IS NULL OR trim(COALESCE(roles, '')) = ''`
  ).run();

  try {
    db.exec("ALTER TABLE users ADD COLUMN telegram_id INTEGER UNIQUE");
  } catch (e) {
    /* column exists */
  }
}

function ensureAdminEmailFromEnv(db) {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) return;
  const row = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1").get();
  if (row) db.prepare("UPDATE users SET email = ? WHERE id = ? AND role = 'admin'").run(email, row.id);
}

function seedIfEmpty(db) {
  const n = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (n > 0) return;

  const hash = bcrypt.hashSync("salon2026", 10);

  const insEmp = db.prepare(
    "INSERT INTO employees (name, slug, active) VALUES (?, ?, 1)"
  );
  const masters = [
    ["Galina", "galina"],
    ["Irina", "irina"],
    ["Viktoria", "viktoria"],
    ["Anne", "anne"],
    ["Alesja", "alesja"],
    ["Aljona", "aljona"],
  ];
  for (const [name, slug] of masters) insEmp.run(name, slug);

  db.prepare(
    "INSERT INTO users (email, password_hash, role, employee_id) VALUES (?, ?, ?, NULL)"
  ).run("owner@alessanna.local", hash, "admin");
  db.prepare(
    "INSERT INTO users (email, password_hash, role, employee_id) VALUES (?, ?, ?, NULL)"
  ).run("manager@alessanna.local", hash, "manager");

  const empRows = db.prepare("SELECT id, slug FROM employees ORDER BY id").all();
  const empBySlug = Object.fromEntries(empRows.map((r) => [r.slug, r.id]));
  const galinaId = empBySlug.galina;
  db.prepare(
    "INSERT INTO users (email, password_hash, role, employee_id) VALUES (?, ?, 'employee', ?)"
  ).run("staff@alessanna.local", hash, galinaId);

  const insSvc = db.prepare(
    `INSERT INTO services (slug, name_et, name_en, duration_min, buffer_after_min, price_cents, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const services = [
    ["hair-cut", "Lõikus", "Стрижка", 60, 10, 3500, 1],
    ["hair-color", "Värvimine", "Окрашивание", 120, 15, 8500, 2],
    ["perm", "Keemiline lokk", "Завивка", 90, 15, 6500, 3],
    ["styling", "Soengud", "Укладки", 45, 10, 2500, 4],
    ["brows-lashes", "Ripsmed ja kulmud", "Ресницы и брови", 60, 10, 4000, 5],
    ["manicure", "Maniküür", "Маникюр", 60, 10, 3500, 6],
    ["pedicure", "Pediküür", "Педикюр", 75, 10, 4500, 7],
  ];
  for (const s of services) insSvc.run(...s);

  const insH = db.prepare(
    "INSERT OR REPLACE INTO salon_hours (weekday, open_min, close_min) VALUES (?, ?, ?)"
  );
  for (let wd = 1; wd <= 6; wd++) insH.run(wd, 10 * 60, 18 * 60);
}

function seedEmployeeServicesIfEmpty(db) {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM employee_services").get().c;
  if (existing > 0) return;

  const empRows = db.prepare("SELECT id, slug FROM employees WHERE slug IS NOT NULL").all();
  const svcRows = db.prepare("SELECT id, slug FROM services WHERE slug IS NOT NULL").all();
  if (!empRows.length || !svcRows.length) return;

  const empBySlug = Object.fromEntries(empRows.map((r) => [r.slug, r.id]));
  const svcBySlug = Object.fromEntries(svcRows.map((r) => [r.slug, r.id]));
  const byService = {
    "hair-cut": ["galina", "irina", "viktoria", "anne"],
    "hair-color": ["galina", "irina", "viktoria", "anne"],
    perm: ["galina", "irina", "viktoria", "anne"],
    styling: ["galina", "irina", "viktoria", "anne"],
    "brows-lashes": ["aljona", "alesja"],
    manicure: ["alesja", "aljona"],
    pedicure: ["alesja", "aljona"],
  };
  const ins = db.prepare("INSERT OR IGNORE INTO employee_services (employee_id, service_id) VALUES (?, ?)");

  const run = db.transaction(() => {
    for (const [serviceSlug, employeeSlugs] of Object.entries(byService)) {
      const serviceId = svcBySlug[serviceSlug];
      if (!serviceId) continue;
      for (const employeeSlug of employeeSlugs) {
        const employeeId = empBySlug[employeeSlug];
        if (employeeId) ins.run(employeeId, serviceId);
      }
    }
  });
  run();
}

function init() {
  const db = open();
  migrate(db);
  seedIfEmpty(db);
  seedEmployeeServicesIfEmpty(db);
  ensureAdminEmailFromEnv(db);
  return db;
}

module.exports = { init, open };
