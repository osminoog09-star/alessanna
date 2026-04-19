/**
 * Admin preview mode for the public marketing site.
 *
 * Зачем:
 *   На лендинге появляются диагностические сообщения от других модулей
 *   (`site-services.mjs` показывает «Часть услуг скрыта на сайте…», и т. п.).
 *   Эти тексты — внутренний чек-лист для администратора салона; обычный
 *   клиент видеть их не должен.
 *
 * Как работает:
 *   Глобальный флаг включения admin-preview хранится в localStorage:
 *     localStorage["salon-admin-preview"] === "1"  → admin режим
 *   Включить / выключить можно URL-параметром:
 *     ?admin=1   — включить и сохранить (URL после очистки заменяется)
 *     ?admin=0   — выключить и сохранить
 *   После загрузки на странице висит маленький золотой бейдж
 *   "ADMIN PREVIEW · выйти", чтобы админ не забыл и мог одним кликом
 *   вернуться в режим обычного клиента.
 *
 * API для других модулей:
 *   import { isAdminPreview, onAdminPreviewChange } from "./site-admin-preview.mjs";
 *   if (isAdminPreview()) showCatalogWarn(...);
 *
 * События:
 *   window 'salon-admin-preview-changed' — выпускается при включении/выключении.
 */

const KEY = "salon-admin-preview";
const URL_PARAM = "admin";
const EVT = "salon-admin-preview-changed";

let cached = null;

function readLs() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch (_) {
    return false;
  }
}

function writeLs(on) {
  try {
    if (on) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch (_) {
    /* ignore */
  }
}

export function isAdminPreview() {
  if (cached !== null) return cached;
  cached = readLs();
  return cached;
}

export function setAdminPreview(on) {
  const next = !!on;
  if (cached === next) return;
  cached = next;
  writeLs(next);
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { enabled: next } }));
  } catch (_) {
    /* ignore */
  }
  syncBadge();
}

export function onAdminPreviewChange(handler) {
  if (typeof handler !== "function") return () => {};
  const wrap = (e) => handler(!!(e && e.detail && e.detail.enabled));
  window.addEventListener(EVT, wrap);
  return () => window.removeEventListener(EVT, wrap);
}

/* Цвет хайлайтов admin-only сообщений. Используем data-attr, чтобы CSS
 * мог опционально подсветить их сильнее, чем обычные `menu-footnote`. */
export function markAdminOnly(el) {
  if (!el || !el.setAttribute) return;
  el.setAttribute("data-admin-only", "1");
}

function consumeUrlParam() {
  let url;
  try {
    url = new URL(window.location.href);
  } catch (_) {
    return;
  }
  if (!url.searchParams.has(URL_PARAM)) return;
  const v = String(url.searchParams.get(URL_PARAM) || "").trim();
  if (v === "1" || v.toLowerCase() === "true" || v === "on") {
    cached = true;
    writeLs(true);
  } else if (v === "0" || v.toLowerCase() === "false" || v === "off") {
    cached = false;
    writeLs(false);
  }
  url.searchParams.delete(URL_PARAM);
  try {
    /* Чистый URL — иначе клиент случайно расшарит «?admin=1». */
    window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
  } catch (_) {
    /* ignore */
  }
}

function injectStyles() {
  if (document.getElementById("ssap-styles")) return;
  const style = document.createElement("style");
  style.id = "ssap-styles";
  style.textContent = `
    .ssap-badge {
      position: fixed;
      bottom: 14px;
      left: 14px;
      z-index: 9000;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.7rem 0.4rem 0.8rem;
      border-radius: 999px;
      border: 1px solid rgba(197, 160, 89, 0.55);
      background:
        radial-gradient(120% 200% at 0% 0%, rgba(197, 160, 89, 0.18), rgba(0,0,0,0) 60%),
        rgba(10, 10, 10, 0.85);
      color: #f1d699;
      font: 600 11px/1.1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      box-shadow: 0 12px 28px -10px rgba(0,0,0,0.65), 0 0 0 1px rgba(197,160,89,0.12);
      backdrop-filter: blur(8px);
      cursor: default;
      user-select: none;
    }
    .ssap-badge::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #f1d699;
      box-shadow: 0 0 6px rgba(241, 214, 153, 0.85);
    }
    .ssap-badge button {
      all: unset;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 10px;
      letter-spacing: 0.06em;
      color: #f1d699;
      border: 1px solid rgba(197, 160, 89, 0.45);
      transition: background 0.18s, color 0.18s;
    }
    .ssap-badge button:hover {
      background: rgba(197, 160, 89, 0.18);
    }
    /* Любые админ-только сообщения скрыты по умолчанию.
     * Когда admin preview включён — на body выставляется data-admin-preview="1"
     * и они становятся видимыми. */
    [data-admin-only="1"] {
      display: none !important;
    }
    body[data-admin-preview="1"] [data-admin-only="1"] {
      display: revert !important;
    }
    body[data-admin-preview="1"] [data-admin-only="1"].menu-footnote {
      display: block !important;
      border: 1px dashed rgba(197, 160, 89, 0.35);
      border-radius: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: rgba(197, 160, 89, 0.06);
    }
  `;
  document.head.appendChild(style);
}

function syncBadge() {
  const on = isAdminPreview();
  if (document.body) {
    document.body.setAttribute("data-admin-preview", on ? "1" : "0");
  }
  const existing = document.getElementById("ssap-badge");
  if (!on) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  injectStyles();
  const wrap = document.createElement("div");
  wrap.id = "ssap-badge";
  wrap.className = "ssap-badge";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-label", "Admin preview mode");
  wrap.innerHTML = '<span>ADMIN PREVIEW</span>';
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "выйти";
  btn.title = "Выключить режим admin preview (вернуться к виду обычного клиента)";
  btn.addEventListener("click", () => setAdminPreview(false));
  wrap.appendChild(btn);
  (document.body || document.documentElement).appendChild(wrap);
}

function init() {
  consumeUrlParam();
  /* Refresh cache after consumeUrlParam mutated it. */
  cached = readLs();
  syncBadge();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
