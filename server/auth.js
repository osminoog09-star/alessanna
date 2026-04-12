"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const COOKIE = "alessanna_token";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function signUser(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employee_id,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function readBearer(req) {
  const h = req.headers.authorization;
  if (h && typeof h === "string" && h.startsWith("Bearer ")) {
    return h.slice(7).trim();
  }
  return null;
}

function authMiddleware() {
  return function auth(req, res, next) {
    let token = req.cookies && req.cookies[COOKIE];
    if (!token) token = readBearer(req);
    if (!token) {
      req.user = null;
      return next();
    }
    try {
      req.user = verifyToken(token);
      next();
    } catch {
      req.user = null;
      next();
    }
  };
}

function requireAuth(req, res, next) {
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: "Login required" });
  }
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !req.user.sub) {
      return res.status(401).json({ error: "Login required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

function loadUserRow(db, userId) {
  return db.prepare("SELECT id, email, role, employee_id FROM users WHERE id = ?").get(Number(userId));
}

module.exports = {
  bcrypt,
  signUser,
  verifyToken,
  authMiddleware,
  requireAuth,
  requireRoles,
  setAuthCookie,
  clearAuthCookie,
  loadUserRow,
  COOKIE,
  JWT_SECRET,
};
