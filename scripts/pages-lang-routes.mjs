/**
 * GitHub Pages: /ru/, /et/, /en/ with correct <html lang> for SEO and calendar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "index.html");
const langs = ["ru", "et", "en"];

const html = fs.readFileSync(src, "utf8");

function redirectHtml(lang) {
  return (
    "<!DOCTYPE html><html lang=\"" +
    lang +
    "\"><head><meta charset=\"utf-8\" />" +
    "<meta http-equiv=\"refresh\" content=\"0;url=/" +
    lang +
    "/\" />" +
    "<link rel=\"canonical\" href=\"/" +
    lang +
    "/\" />" +
    "<script>location.replace(\"/" +
    lang +
    "/\"+location.search+location.hash);</script>" +
    "</head><body><p><a href=\"/" +
    lang +
    "/\">AlesSanna Ilusalong</a></p></body></html>"
  );
}

export function writeLangRoutes(outDir) {
  for (const lang of langs) {
    const dir = path.join(outDir, lang);
    fs.mkdirSync(dir, { recursive: true });
    const localized = html.replace(/^<html lang="[^"]*"/m, `<html lang="${lang}"`);
    fs.writeFileSync(path.join(dir, "index.html"), localized);
    fs.writeFileSync(path.join(outDir, lang + ".html"), redirectHtml(lang));
  }
}

if (process.argv[1] && process.argv[1].endsWith("pages-lang-routes.mjs")) {
  const out = process.argv[2] || path.join(root, "_site");
  writeLangRoutes(out);
  console.log("lang routes:", langs.map((l) => `/${l}/`).join(", "));
}
