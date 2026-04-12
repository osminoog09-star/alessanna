"use strict";

const fs = require("fs");
const path = require("path");

const PUBLIC_LANGS = ["ru", "et", "fi", "en"];

/** Title + meta description per locale (SEO). */
const SEO_BY_LANG = {
  ru: {
    title: "AlesSanna – Премиальный салон красоты в Пярну",
    description:
      "Премиальный салон красоты в Пярну. Элегантность, забота и спокойная атмосфера. Онлайн-запись и контакты.",
  },
  et: {
    title: "AlesSanna – Luksuslik ilusalong Pärnus",
    description:
      "Luksuslik ilusalong Pärnus. Elegantsus, ilu ja hoolitus — rahulik kogemus. Broneeri aeg ja vaata kontakte.",
  },
  fi: {
    title: "AlesSanna – Premium kauneushoitola Pärnussa",
    description:
      "Premium kauneushoitola Pärnussa. Eleganssia ja huolenpitoa. Varaa aika ja tutustu yhteystietoihin.",
  },
  en: {
    title: "AlesSanna – Luxury beauty salon in Pärnu",
    description:
      "Luxury beauty salon in Pärnu. Premium care, calm atmosphere, and elegant service. Book online and get in touch.",
  },
};

const OG_LOCALE = {
  ru: "ru_RU",
  et: "et_EE",
  fi: "fi_FI",
  en: "en_US",
};

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Server-side locale guess from Accept-Language; default et (salon in Estonia, aligns with /index.html → /et). */
function pickLocaleFromAcceptLanguage(header) {
  if (!header || typeof header !== "string") return "et";
  const parts = header.split(",").map((p) => p.trim().split(";")[0].toLowerCase());
  for (const p of parts) {
    const code = p.slice(0, 2);
    if (PUBLIC_LANGS.includes(code)) return code;
  }
  return "et";
}

let indexTemplate = null;
function getIndexTemplate(rootDir) {
  if (!indexTemplate) {
    indexTemplate = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  }
  return indexTemplate;
}

/**
 * Build localized landing HTML: lang, title, description, hreflang, canonical, og:*, lang sync script.
 */
function renderPublicLandingHtml(rootDir, req, lang) {
  const safeLang = PUBLIC_LANGS.includes(lang) ? lang : "en";
  const seo = SEO_BY_LANG[safeLang] || SEO_BY_LANG.en;
  const host = req.get("host") || "localhost";
  const proto = req.protocol || "http";
  const base = `${proto}://${host}`;
  const canonical = `${base}/${safeLang}`;

  let html = getIndexTemplate(rootDir);

  html = html.replace(/^<html lang="[^"]*"/m, `<html lang="${safeLang}"`);

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(seo.title)}</title>`);

  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${escapeAttr(seo.description)}" />`
  );

  const hreflangBlock = [
    ...PUBLIC_LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${base}/${l}" />`),
    `  <link rel="alternate" hreflang="x-default" href="${base}/en" />`,
    `  <link rel="canonical" href="${escapeAttr(canonical)}" />`,
  ].join("\n");

  const ogBlock = [
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:url" content="${escapeAttr(canonical)}" />`,
    `  <meta property="og:title" content="${escapeAttr(seo.title)}" />`,
    `  <meta property="og:description" content="${escapeAttr(seo.description)}" />`,
    `  <meta property="og:locale" content="${escapeAttr(OG_LOCALE[safeLang] || OG_LOCALE.en)}" />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${escapeAttr(seo.title)}" />`,
    `  <meta name="twitter:description" content="${escapeAttr(seo.description)}" />`,
  ].join("\n");

  /**
   * Persist locale from URL (source of truth) — no redirects here, so the RU|ET|FI|EN switcher never fights saved prefs.
   * First-time language guess: GET / uses pickLocaleFromAcceptLanguage (same rules: supported or en).
   */
  const syncScript = `
  <script>
  (function(){
    var S=["ru","et","fi","en"];
    var seg=(location.pathname.split("/").filter(Boolean)[0]||"").toLowerCase();
    if(S.indexOf(seg)<0)return;
    try{localStorage.setItem("lang",seg);}catch(e){}
  })();
  </script>`;

  const langLinks = PUBLIC_LANGS.map((l, i) => {
    const active = l === safeLang ? ' class="is-active"' : "";
    const sep =
      i > 0 ? '\n          <span class="lang-switch-sep" aria-hidden="true">|</span>\n          ' : "";
    return `${sep}<a href="/${l}"${active}>${l.toUpperCase()}</a>`;
  }).join("");

  html = html.replace(
    /<span class="lang-switch"[^>]*>[\s\S]*?<\/span>/,
    `<span class="lang-switch" data-i18n-attr="aria-label:common.language">\n          ${langLinks}\n        </span>`
  );

  html = html.replace(
    /<div class="site-switcher"[^>]*>[\s\S]*?<\/div>/,
    `<div class="site-switcher" data-i18n-attr="aria-label:site.siteSwitcherLabel">
        <a href="/${safeLang}" class="is-active" data-i18n="site.siteSwitcherSalon">Ilusalong</a>
        <span class="site-switcher-sep" aria-hidden="true">/</span>
        <a href="mave.html">MAVE</a>
      </div>`
  );

  html = html.replace("<!-- __SEO_EXTRAS__ -->", `${hreflangBlock}\n${ogBlock}\n${syncScript}`);

  return html;
}

module.exports = {
  PUBLIC_LANGS,
  SEO_BY_LANG,
  pickLocaleFromAcceptLanguage,
  renderPublicLandingHtml,
  getIndexTemplate,
};
