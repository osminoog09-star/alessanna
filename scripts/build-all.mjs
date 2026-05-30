/**
 * Unified Vercel build: landing page (static) + CRM (Vite).
 *
 * Output layout in dist/:
 *   dist/                  — landing page static files
 *   dist/_crm_dist/        — CRM Vite build (served transparently via middleware)
 *
 * Edge Middleware (middleware.js) proxies work.alessannailu.com/* → dist/_crm_dist/*
 * so the CRM keeps its normal URL structure (no /_crm/ prefix visible to users).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

// ── helpers ──────────────────────────────────────────────────────────────────

function cp(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) { console.warn(`skip (missing): ${rel}`); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function cpDir(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  if (!fs.existsSync(src)) { console.warn(`skip (missing dir): ${rel}`); return; }
  fs.cpSync(src, dst, { recursive: true });
}

function cpDirTo(srcRel, dstRel) {
  const src = path.join(root, srcRel);
  const dst = path.join(dist, dstRel);
  if (!fs.existsSync(src)) { console.warn(`skip (missing dir): ${srcRel}`); return; }
  fs.cpSync(src, dst, { recursive: true });
}

// ── 1. CRM build ─────────────────────────────────────────────────────────────

console.log("\n=== [1/3] Building CRM (work/) ===");
const workDir = path.join(root, "work");
execSync("npm install --prefer-offline 2>/dev/null || npm install", {
  cwd: workDir, stdio: "inherit", shell: true,
});
// Base stays '/' — React Router works normally, URL stays work.alessannailu.com/*
// VITE_ vars are baked in at build time; .vercelignore blocks .env files so we
// inject them here directly (both are public anon-level keys, safe to commit).
execSync("npm run build", {
  cwd: workDir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: "https://eclrkusmwcrtnxqhzpky.supabase.co",
    VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjbHJrdXNtd2NydG54cWh6cGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDU3ODEsImV4cCI6MjA5MTU4MTc4MX0.FpTqRxDFBToOCyfjJCOj2NvOwTol__4qGDgLp6Q8JUg",
  },
});

// ── 2. Prepare dist/ ─────────────────────────────────────────────────────────

console.log("\n=== [2/3] Copying landing page files ===");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Root HTML pages
for (const f of [
  "index.html", "404.html", "cookies.html", "privacy.html",
  "en.html", "et.html", "ru.html", "work.html",
]) cp(f);

// Styles & scripts
for (const f of [
  "styles.css", "legal.css", "work.css",
  "script.js", "work.js", "catalog-i18n.js",
  "cookie-consent.js", "translations.js", "legal-renderer.js",
  "supabase-public-config.js",
]) cp(f);

// ES modules (loaded as <script type=module> in landing pages)
for (const f of [
  "site-services.mjs", "site-team.mjs", "site-support-chat.mjs",
  "site-builder.mjs", "site-admin-preview.mjs",
]) cp(f);

// Language sub-sites
for (const d of ["ru", "et", "en"]) cpDir(d);

// Shared directories
cpDir("assets");
cpDir("locales");

// public-site booking widget: expose at root so ./book.css etc. resolve
for (const f of ["book.html", "book.css", "book.js", "config.js"]) {
  const src = path.join(root, "public-site", f);
  const dst = path.join(dist, f);
  if (!fs.existsSync(src)) { console.warn(`skip (missing): public-site/${f}`); continue; }
  fs.copyFileSync(src, dst);
}

// ── 3. Copy CRM build → dist/_crm_dist/ ──────────────────────────────────────

console.log("\n=== [3/3] Copying CRM build → dist/_crm_dist/ ===");
cpDirTo("work/dist", "_crm_dist");

console.log("\n=== Build complete ===");
console.log("Landing files:", fs.readdirSync(dist).filter(f => !f.startsWith("_")).slice(0, 12).join(", "));
console.log("CRM files:", fs.readdirSync(path.join(dist, "_crm_dist")).slice(0, 5).join(", "));
