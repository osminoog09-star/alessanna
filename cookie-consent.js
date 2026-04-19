/* ============================================================================
 *  cookie-consent.js
 *  ----------------------------------------------------------------------------
 *  Лёгкий cookie-баннер для публичного сайта alessannailu.com.
 *
 *  ЧТО ДЕЛАЕТ.
 *  1. При первом визите создаёт стабильный анонимный `cookie_id` (UUIDv4),
 *     сохраняет в localStorage. Этот id мы используем как «персонализированный
 *     ключ» для телеметрии и для записи cookie-согласия.
 *  2. Если согласие текущей версии политики ещё не дано — показывает баннер
 *     внизу экрана. Кнопки:
 *       • «Принять все»                → essential + analytics + marketing
 *       • «Только обязательные»        → essential
 *       • «Настроить»                  → разворачивает чек-боксы по категориям
 *     Согласие пишется и в localStorage, и через RPC `client_record_consent`
 *     в БД (с IP и user-agent).
 *  3. Дальше на странице доступен модуль `window.AlesSannaConsent`:
 *       • .getConsent() → { categories, version, decidedAt } | null
 *       • .canRunAnalytics() / .canRunMarketing()
 *       • .openSettings()  — снова показать баннер
 *       • .reset()         — стереть согласие (для теста)
 *       • .logEvent(action, meta) — отправить событие в activity_log
 *  4. Auto-логирует базовое событие `site.visit` один раз за сессию (если
 *     согласие на analytics дано).
 *
 *  ЗАВИСИМОСТИ.
 *  • supabase-public-config.js (window.SUPABASE_CONFIG.url + .anonKey)
 *    Подключён в index.html ВЫШЕ этого файла.
 *  • Чистый ванильный JS, без npm-зависимостей. Грузим plain-script `defer`.
 *
 *  ВЕРСИЯ ПОЛИТИКИ.
 *  Привязана к строке POLICY_VERSION ниже. Если меняем тексты политики —
 *  меняем здесь, и баннер автоматически перепросит у всех клиентов.
 *  Совпадает с version в legal_documents (миграция 055).
 * ============================================================================
 */
(function () {
  "use strict";

  var POLICY_VERSION = "2026-04-19";

  var STORAGE = {
    cookieId: "alessanna.client.cookieId",
    consent: "alessanna.client.consent.v1",
    sessionLogged: "alessanna.client.session.visitLogged",
  };

  var ENDPOINT = (function () {
    var cfg = window.SUPABASE_CONFIG || {};
    var url = String(cfg.url || "").replace(/\/+$/, "");
    var key = String(cfg.anonKey || "");
    if (!url || !key) return null;
    return { url: url + "/rest/v1/rpc/", key: key };
  })();

  function uuidv4() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      try {
        return crypto.randomUUID();
      } catch (_) {}
    }
    var t = (Date.now() + Math.random()).toString();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }) + (t.length ? "" : "");
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }
  function writeStorage(key, val) {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(val));
    } catch (_) {}
  }

  function ensureCookieId() {
    var existing = readStorage(STORAGE.cookieId);
    if (existing && existing.length >= 8) return existing;
    var id = uuidv4();
    writeStorage(STORAGE.cookieId, id);
    return id;
  }

  function readConsent() {
    var raw = readStorage(STORAGE.consent);
    if (!raw) return null;
    try {
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object" || !Array.isArray(p.categories)) return null;
      return p;
    } catch (_) {
      return null;
    }
  }
  function writeConsent(categories) {
    var p = {
      version: POLICY_VERSION,
      categories: categories.slice(),
      decidedAt: new Date().toISOString(),
    };
    writeStorage(STORAGE.consent, JSON.stringify(p));
    return p;
  }
  function clearConsent() {
    writeStorage(STORAGE.consent, null);
  }

  function isConsentValid(p) {
    return p && p.version === POLICY_VERSION && Array.isArray(p.categories);
  }

  function rpc(name, payload) {
    if (!ENDPOINT) return Promise.resolve(null);
    return fetch(ENDPOINT.url + name, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": ENDPOINT.key,
        "authorization": "Bearer " + ENDPOINT.key,
      },
      body: JSON.stringify(payload || {}),
    })
      .then(function (r) {
        if (!r.ok) return null;
        return r.json().catch(function () {
          return null;
        });
      })
      .catch(function () {
        return null;
      });
  }

  function recordConsent(cookieId, categories) {
    return rpc("client_record_consent", {
      p_cookie_id: cookieId,
      p_policy_version: POLICY_VERSION,
      p_categories: categories,
    });
  }

  function logEvent(cookieId, action, meta) {
    var consent = readConsent();
    /* essential — всегда. analytics-события шлём только при согласии. */
    if (action.indexOf("essential.") !== 0) {
      if (!consent || consent.categories.indexOf("analytics") === -1) {
        return Promise.resolve(null);
      }
    }
    return rpc("client_log_activity", {
      p_cookie_id: cookieId,
      p_action: String(action || "").slice(0, 80),
      p_meta: meta && typeof meta === "object" ? meta : {},
    });
  }

  /* ────────────────────────────────────────────────────────────── UI render */

  var STRINGS = {
    ru: {
      title: "Куки и приватность",
      lead:
        "Мы используем cookie, чтобы сайт работал и чтобы понять, какие услуги " +
        "интересны посетителям. Подробнее — в",
      privacyLink: "Политике конфиденциальности",
      cookieLink: "Политике cookie",
      acceptAll: "Принять все",
      essentialOnly: "Только обязательные",
      customize: "Настроить",
      save: "Сохранить выбор",
      categoryEssential: "Обязательные",
      categoryEssentialHint: "Нужны для работы сайта (сессия, корзина). Включены всегда.",
      categoryAnalytics: "Аналитика",
      categoryAnalyticsHint: "Анонимная статистика просмотров — помогает нам улучшать каталог.",
      categoryMarketing: "Маркетинг",
      categoryMarketingHint: "Тег для ремаркетинга. Сейчас не активен, оставлен на будущее.",
      settings: "Настройки cookie",
    },
    et: {
      title: "Küpsised ja privaatsus",
      lead:
        "Kasutame küpsiseid, et sait töötaks ja et mõista, milliseid teenuseid " +
        "külastajad otsivad. Loe lähemalt:",
      privacyLink: "Privaatsuspoliitika",
      cookieLink: "Küpsiste poliitika",
      acceptAll: "Nõustun kõigega",
      essentialOnly: "Ainult kohustuslikud",
      customize: "Seaded",
      save: "Salvesta valik",
      categoryEssential: "Kohustuslikud",
      categoryEssentialHint: "Vajalikud saidi tööks. Alati sisse lülitatud.",
      categoryAnalytics: "Analüütika",
      categoryAnalyticsHint: "Anonüümne statistika — aitab meil kataloogi parandada.",
      categoryMarketing: "Turundus",
      categoryMarketingHint: "Remarketingi tag. Praegu pole aktiivne.",
      settings: "Küpsiste seaded",
    },
  };

  function getLang() {
    var html = document.documentElement.getAttribute("lang") || "ru";
    return html.toLowerCase().indexOf("et") === 0 ? "et" : "ru";
  }

  function injectStyles() {
    if (document.getElementById("alsnn-consent-style")) return;
    var css =
      ".alsnn-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
      "background:rgba(15,15,15,0.97);color:#ecece8;border-top:1px solid rgba(196,165,116,0.45);" +
      "box-shadow:0 -8px 32px rgba(0,0,0,0.45);font-family:Inter,Helvetica,Arial,sans-serif;" +
      "font-size:14px;line-height:1.5;backdrop-filter:blur(8px);}" +
      ".alsnn-consent__inner{max-width:1100px;margin:0 auto;padding:18px 22px;" +
      "display:grid;gap:14px;grid-template-columns:1fr;align-items:start;}" +
      "@media (min-width:760px){.alsnn-consent__inner{grid-template-columns:1fr auto;}}" +
      ".alsnn-consent__title{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;" +
      "font-size:20px;font-weight:500;color:#c4a574;margin:0 0 4px;letter-spacing:0.01em;}" +
      ".alsnn-consent__lead{margin:0;color:#cfcec8;}" +
      ".alsnn-consent__lead a{color:#c4a574;text-decoration:underline;text-underline-offset:3px;}" +
      ".alsnn-consent__actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}" +
      ".alsnn-btn{appearance:none;border:1px solid rgba(196,165,116,0.45);background:transparent;" +
      "color:#ecece8;font:inherit;padding:9px 14px;border-radius:8px;cursor:pointer;" +
      "transition:background 0.18s,color 0.18s,border-color 0.18s;}" +
      ".alsnn-btn:hover{background:rgba(196,165,116,0.12);}" +
      ".alsnn-btn--primary{background:#c4a574;color:#0a0a0a;border-color:#c4a574;font-weight:600;}" +
      ".alsnn-btn--primary:hover{background:#d4b585;border-color:#d4b585;}" +
      ".alsnn-btn--ghost{border-color:rgba(255,255,255,0.18);color:#cfcec8;}" +
      ".alsnn-consent__panel{margin-top:6px;border-top:1px solid rgba(255,255,255,0.08);" +
      "padding-top:12px;display:grid;gap:10px;}" +
      ".alsnn-consent__cat{display:flex;gap:10px;align-items:flex-start;padding:6px 0;}" +
      ".alsnn-consent__cat input{margin-top:3px;}" +
      ".alsnn-consent__cat label{cursor:pointer;}" +
      ".alsnn-consent__cat strong{display:block;color:#ecece8;}" +
      ".alsnn-consent__cat span{display:block;color:#9b988e;font-size:12.5px;margin-top:2px;}" +
      ".alsnn-consent__panel-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}" +
      ".alsnn-consent-fab{position:fixed;left:14px;bottom:14px;z-index:9998;" +
      "background:rgba(20,20,20,0.85);color:#c4a574;border:1px solid rgba(196,165,116,0.45);" +
      "border-radius:999px;padding:8px 14px;font:inherit;font-size:12px;cursor:pointer;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.35);}" +
      ".alsnn-consent-fab:hover{background:rgba(40,40,40,0.95);}";
    var style = document.createElement("style");
    style.id = "alsnn-consent-style";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function buildBanner(opts) {
    var lang = getLang();
    var T = STRINGS[lang] || STRINGS.ru;
    injectStyles();

    var wrap = document.createElement("div");
    wrap.className = "alsnn-consent";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-live", "polite");
    wrap.setAttribute("aria-label", T.title);

    var inner = document.createElement("div");
    inner.className = "alsnn-consent__inner";
    wrap.appendChild(inner);

    var left = document.createElement("div");
    left.innerHTML =
      '<p class="alsnn-consent__title">' + T.title + "</p>" +
      '<p class="alsnn-consent__lead">' + T.lead +
      ' <a href="/privacy.html">' + T.privacyLink + "</a>" +
      ' / <a href="/cookies.html">' + T.cookieLink + "</a>." +
      "</p>";
    inner.appendChild(left);

    var actions = document.createElement("div");
    actions.className = "alsnn-consent__actions";

    var btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.className = "alsnn-btn alsnn-btn--primary";
    btnAll.textContent = T.acceptAll;

    var btnEssential = document.createElement("button");
    btnEssential.type = "button";
    btnEssential.className = "alsnn-btn alsnn-btn--ghost";
    btnEssential.textContent = T.essentialOnly;

    var btnCustom = document.createElement("button");
    btnCustom.type = "button";
    btnCustom.className = "alsnn-btn";
    btnCustom.textContent = T.customize;

    actions.appendChild(btnAll);
    actions.appendChild(btnEssential);
    actions.appendChild(btnCustom);
    inner.appendChild(actions);

    var panel = document.createElement("div");
    panel.className = "alsnn-consent__panel";
    panel.style.display = "none";
    panel.style.gridColumn = "1 / -1";

    function makeCat(id, name, hint, locked) {
      var w = document.createElement("div");
      w.className = "alsnn-consent__cat";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = "alsnn-cat-" + id;
      input.value = id;
      input.checked = !!opts.defaults[id] || locked;
      if (locked) {
        input.disabled = true;
      }
      var lbl = document.createElement("label");
      lbl.setAttribute("for", input.id);
      lbl.innerHTML = "<strong>" + name + "</strong><span>" + hint + "</span>";
      w.appendChild(input);
      w.appendChild(lbl);
      return { wrap: w, input: input };
    }

    var catEssential = makeCat("essential", T.categoryEssential, T.categoryEssentialHint, true);
    var catAnalytics = makeCat("analytics", T.categoryAnalytics, T.categoryAnalyticsHint, false);
    var catMarketing = makeCat("marketing", T.categoryMarketing, T.categoryMarketingHint, false);

    panel.appendChild(catEssential.wrap);
    panel.appendChild(catAnalytics.wrap);
    panel.appendChild(catMarketing.wrap);

    var panelActions = document.createElement("div");
    panelActions.className = "alsnn-consent__panel-actions";
    var btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "alsnn-btn alsnn-btn--primary";
    btnSave.textContent = T.save;
    panelActions.appendChild(btnSave);
    panel.appendChild(panelActions);

    inner.appendChild(panel);

    function commit(cats) {
      var p = writeConsent(cats);
      var cookieId = ensureCookieId();
      recordConsent(cookieId, cats);
      try {
        wrap.remove();
      } catch (_) {}
      window.dispatchEvent(
        new CustomEvent("alsnn:consent", { detail: p }),
      );
      maybeLogVisit();
    }

    btnAll.addEventListener("click", function () {
      commit(["essential", "analytics", "marketing"]);
    });
    btnEssential.addEventListener("click", function () {
      commit(["essential"]);
    });
    btnCustom.addEventListener("click", function () {
      panel.style.display = panel.style.display === "none" ? "grid" : "none";
    });
    btnSave.addEventListener("click", function () {
      var cats = ["essential"];
      if (catAnalytics.input.checked) cats.push("analytics");
      if (catMarketing.input.checked) cats.push("marketing");
      commit(cats);
    });

    return wrap;
  }

  function showFab() {
    if (document.querySelector(".alsnn-consent-fab")) return;
    injectStyles();
    var T = STRINGS[getLang()] || STRINGS.ru;
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "alsnn-consent-fab";
    fab.textContent = T.settings;
    fab.addEventListener("click", function () {
      openSettings();
    });
    document.body.appendChild(fab);
  }

  function maybeLogVisit() {
    if (sessionStorage && sessionStorage.getItem(STORAGE.sessionLogged)) return;
    try {
      sessionStorage.setItem(STORAGE.sessionLogged, "1");
    } catch (_) {}
    var cookieId = ensureCookieId();
    logEvent(cookieId, "site.visit", {
      path: location.pathname,
      ref: document.referrer ? document.referrer.slice(0, 200) : null,
      lang: getLang(),
    });
  }

  function openSettings() {
    var existing = document.querySelector(".alsnn-consent");
    if (existing) {
      try {
        existing.remove();
      } catch (_) {}
    }
    var current = readConsent();
    var defaults = current && current.categories
      ? {
          essential: true,
          analytics: current.categories.indexOf("analytics") !== -1,
          marketing: current.categories.indexOf("marketing") !== -1,
        }
      : { essential: true, analytics: false, marketing: false };
    var banner = buildBanner({ defaults: defaults });
    document.body.appendChild(banner);
  }

  function reset() {
    clearConsent();
    var existing = document.querySelector(".alsnn-consent");
    if (existing) existing.remove();
    openSettings();
  }

  function init() {
    ensureCookieId();
    var consent = readConsent();
    if (!isConsentValid(consent)) {
      var banner = buildBanner({
        defaults: { essential: true, analytics: false, marketing: false },
      });
      document.body.appendChild(banner);
    } else {
      maybeLogVisit();
    }
    showFab();
  }

  /* Публичный API. */
  window.AlesSannaConsent = {
    POLICY_VERSION: POLICY_VERSION,
    getConsent: readConsent,
    canRunAnalytics: function () {
      var c = readConsent();
      return !!(c && c.categories.indexOf("analytics") !== -1);
    },
    canRunMarketing: function () {
      var c = readConsent();
      return !!(c && c.categories.indexOf("marketing") !== -1);
    },
    openSettings: openSettings,
    reset: reset,
    logEvent: function (action, meta) {
      var cookieId = ensureCookieId();
      return logEvent(cookieId, action, meta);
    },
    cookieId: function () {
      return ensureCookieId();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
