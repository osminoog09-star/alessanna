"use strict";

/** Digits only, for comparison. */
function normalizePhone(input) {
  return String(input || "").replace(/\D/g, "");
}

/** Match national or international forms (e.g. 55686845 vs +37255686845). */
function phonesMatch(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = 8;
  if (x.length >= tail && y.length >= tail && x.slice(-tail) === y.slice(-tail)) return true;
  return false;
}

/**
 * Find app user id by verified phone: env admin match, else employee.phone → users.employee_id.
 */
function findUserIdByPhone(db, digits) {
  if (!digits) return null;

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPhone = process.env.ADMIN_PHONE || "";
  if (adminPhone && phonesMatch(adminPhone, digits) && adminEmail) {
    const adminUser = db.prepare("SELECT id FROM users WHERE lower(email) = ? AND role = 'admin'").get(adminEmail);
    if (adminUser) return adminUser.id;
  }

  const rows = db
    .prepare("SELECT id, phone FROM employees WHERE active = 1 AND phone IS NOT NULL AND trim(phone) != ''")
    .all();
  for (const e of rows) {
    if (!phonesMatch(e.phone, digits)) continue;
    const u = db.prepare("SELECT id FROM users WHERE employee_id = ?").get(e.id);
    if (u) return u.id;
  }
  return null;
}

module.exports = { normalizePhone, findUserIdByPhone, phonesMatch };
