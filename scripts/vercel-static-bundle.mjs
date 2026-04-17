/**
 * Vercel build: копирует только публичные статические файлы лендинга в vercel-static-out/.
 * Сервер Node (server/), БД, CRM и секреты в артефакт не попадают.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "vercel-static-out");

const ROOT_FILES = [
  "index.html",
  "work.html",
  "styles.css",
  "script.js",
  "translations.js",
  "work.css",
  "work.js",
];

function rmOut() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
}

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(out, rel);
  if (!fs.existsSync(from)) {
    console.error(`Missing required file: ${rel}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(rel) {
  const from = path.join(root, rel);
  const to = path.join(out, rel);
  if (!fs.existsSync(from)) {
    console.error(`Missing required directory: ${rel}`);
    process.exit(1);
  }
  fs.cpSync(from, to, { recursive: true });
}

rmOut();

for (const f of ROOT_FILES) {
  copyFile(f);
}

copyDir("locales");
copyDir("assets");

for (const f of [
  "supabase-public-config.js",
  "site-services.mjs",
  "site-team.mjs",
  "site-builder.mjs",
]) {
  copyFile(f);
}

// public-site/book.html → корень (пути ./book.css, ./book.js)
for (const f of ["book.html", "book.css", "book.js", "config.js"]) {
  const from = path.join(root, "public-site", f);
  const to = path.join(out, f);
  if (!fs.existsSync(from)) {
    console.warn(`Optional skip: public-site/${f}`);
    continue;
  }
  fs.copyFileSync(from, to);
}

console.log("vercel-static-out ready:", out);
