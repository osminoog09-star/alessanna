/**
 * Support chat widget for the public marketing site.
 *
 * Visitor enters a name (required) + email (optional) + topic (salon/site) and
 * first message. All traffic goes through SECURITY DEFINER RPC:
 *   - support_visitor_start_thread
 *   - support_visitor_post_message
 *   - support_visitor_fetch
 *   - support_visitor_mark_read
 *
 * `visitor_session_token` lives in localStorage and is the only handle for
 * accessing the thread — no direct table access.
 *
 * The CRM (/admin/support) sees two topics with role-based visibility:
 *   - salon → managers + admins
 *   - site  → admins only
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LOG_PREFIX = "[site-support-chat]";
const STORAGE_SESSION = "site_support_session_v1";
const STORAGE_PROFILE = "site_support_profile_v1";
const STORAGE_STATE = "site_support_state_v1";
const POLL_OPEN_MS = 4000;
const POLL_CLOSED_MS = 20000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const BUCKET = "support-attachments";

function log(...a) {
  try {
    console.info(LOG_PREFIX, ...a);
  } catch (_) {
    /* ignore */
  }
}

function detectLang() {
  const raw = String(
    (document.documentElement && document.documentElement.lang) || "ru"
  )
    .toLowerCase()
    .slice(0, 2);
  return raw === "et" ? "et" : "ru";
}

const I18N = {
  ru: {
    launcherLabel: "Написать в поддержку",
    launcherTeaser: "Чат · онлайн",
    nudgeTitle: "Здравствуйте!",
    nudgeText: "Можем помочь с записью или ответить на вопрос — напишите нам.",
    nudgeClose: "Скрыть",
    headerTitle: "AlesSanna · поддержка",
    headerSub: "онлайн · отвечаем в течение часа",
    close: "Закрыть",
    back: "← Назад",
    welcome: "Здравствуйте! Как к вам обращаться?",
    nameLabel: "Ваше имя",
    namePh: "Например, Анна",
    emailLabel: "Email (по желанию)",
    emailPh: "чтобы ответить, даже если вы уйдёте со страницы",
    topicLabel: "О чём хотите написать?",
    topicSalon: "Вопрос в салон",
    topicSalonSub: "запись, услуги, мастера",
    topicSite: "Техподдержка сайта",
    topicSiteSub: "не работает форма, баг, идея",
    messageLabel: "Ваше сообщение",
    messagePh: "Коротко опишите, что нужно…",
    start: "Отправить",
    starting: "Отправляем…",
    nameRequired: "Пожалуйста, укажите имя.",
    messageRequired: "Напишите сообщение.",
    err: "Не получилось отправить. Попробуйте ещё раз.",
    replyPh: "Напишите сообщение…",
    send: "Отправить",
    sending: "…",
    loading: "Загрузка…",
    attach: "Прикрепить файл",
    attachTooLarge: "Файл больше 8 МБ — отправьте поменьше.",
    attachErr: "Не удалось загрузить файл.",
    you: "Вы",
    salon: "Салон",
    support: "Поддержка",
    typing: "поддержка печатает",
    emptyThread: "Начните переписку.",
    hintEnter: "Enter — отправить · Shift+Enter — перенос",
    resetThread: "Начать новый диалог",
    resetConfirm: "Начать новый диалог? Текущая переписка скроется.",
    statusClosed: "Диалог закрыт сотрудником. Напишите сообщение, чтобы открыть снова.",
    poweredBy: "Защищённый чат · ваши сообщения видит только команда AlesSanna",
  },
  et: {
    launcherLabel: "Kirjuta tugiteenusele",
    launcherTeaser: "Vestlus · võrgus",
    nudgeTitle: "Tere!",
    nudgeText: "Aitame broneeringuga või vastame küsimusele — kirjuta meile.",
    nudgeClose: "Peida",
    headerTitle: "AlesSanna · tugi",
    headerSub: "võrgus · vastame tunni jooksul",
    close: "Sulge",
    back: "← Tagasi",
    welcome: "Tere! Kuidas teie poole pöörduda?",
    nameLabel: "Teie nimi",
    namePh: "Näiteks Anna",
    emailLabel: "E-post (soovi korral)",
    emailPh: "et saaksime vastata, kui lahkute lehelt",
    topicLabel: "Millest soovite kirjutada?",
    topicSalon: "Küsimus salongile",
    topicSalonSub: "broneering, teenused, meistrid",
    topicSite: "Veebi tehniline tugi",
    topicSiteSub: "vorm ei tööta, viga, idee",
    messageLabel: "Teie sõnum",
    messagePh: "Kirjuta lühidalt, mida vajate…",
    start: "Saada",
    starting: "Saadame…",
    nameRequired: "Palun sisesta nimi.",
    messageRequired: "Kirjuta sõnum.",
    err: "Saatmine ebaõnnestus. Proovi uuesti.",
    replyPh: "Kirjuta sõnum…",
    send: "Saada",
    sending: "…",
    loading: "Laadimine…",
    attach: "Lisa fail",
    attachTooLarge: "Fail on suurem kui 8 MB — saatke väiksem.",
    attachErr: "Faili üleslaadimine ebaõnnestus.",
    you: "Teie",
    salon: "Salong",
    support: "Tugi",
    typing: "tugi kirjutab",
    emptyThread: "Alusta vestlust.",
    hintEnter: "Enter — saada · Shift+Enter — reavahetus",
    resetThread: "Alusta uut vestlust",
    resetConfirm: "Alusta uut vestlust? Praegune peidetakse.",
    statusClosed: "Vestluse sulges töötaja. Kirjuta sõnum, et avada uuesti.",
    poweredBy: "Turvaline vestlus · teie sõnumeid näeb ainult AlesSanna meeskond",
  },
};

const L = I18N[detectLang()];

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
function readLS(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}
function writeLS(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
  } catch (_) {
    /* ignore */
  }
}

function getOrCreateSessionToken() {
  let t = readLS(STORAGE_SESSION);
  if (t && t.length >= 24) return t;
  t = "sss_" + crypto.getRandomValues(new Uint8Array(16)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), "");
  writeLS(STORAGE_SESSION, t);
  return t;
}

function getProfile() {
  return safeParse(readLS(STORAGE_PROFILE)) || null;
}
function saveProfile(p) {
  writeLS(STORAGE_PROFILE, p);
}

function getPersistedState() {
  return safeParse(readLS(STORAGE_STATE)) || {};
}
function savePersistedState(s) {
  writeLS(STORAGE_STATE, s);
}

function getCfg() {
  const sc = globalThis.SUPABASE_CONFIG || {};
  let url = String(sc.url || "").trim();
  let key = String(sc.anonKey || "").trim();
  if (!url) url = String(globalThis.SALON_SUPABASE_URL || "").trim();
  if (!key) key = String(globalThis.SALON_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return null;
  const lk = key.toLowerCase();
  if (lk.includes("your_anon_key") || lk.includes("placeholder")) return null;
  return { url: url.replace(/\/+$/, ""), anonKey: key };
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const same =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const t = d.toLocaleTimeString(detectLang() === "et" ? "et-EE" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (same) return t;
    const dt = d.toLocaleDateString(detectLang() === "et" ? "et-EE" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
    });
    return dt + " · " + t;
  } catch (_) {
    return "";
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkify(text) {
  return escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noreferrer noopener">${u}</a>`);
}

function injectStyles() {
  if (document.getElementById("site-support-chat-styles")) return;
  const style = document.createElement("style");
  style.id = "site-support-chat-styles";
  style.textContent = `
.ssc-root {
  /* Дизайн-токены: выразительное золото + тёплый тёмный, с достаточной WCAG-контрастностью.
     Палитра мягче и ярче, чтобы лончер не сливался с тёмным фоном салона. */
  --ssc-gold:        #d9b26a;
  --ssc-gold-soft:   #f3d98a;
  --ssc-gold-strong: #e9c57a;
  --ssc-gold-deep:   #8a6a2a;
  --ssc-bg:          #0b0b0e;
  --ssc-panel:       #14141b;
  --ssc-panel-2:     #1c1c25;
  --ssc-line:        rgba(217, 178, 106, 0.22);
  --ssc-text:        #f4efe3;
  --ssc-muted:       #98938a;
  --ssc-green:       #52d89a;
  position: fixed; inset: auto auto 0 0; z-index: 9998;
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ssc-text);
  pointer-events: none;
}
.ssc-root > * { pointer-events: auto; }

/* ---------- Лончер: выносим в обёртку, чтобы рядом жили label и nudge ---------- */
.ssc-launcher-wrap {
  position: fixed;
  left: clamp(16px, 3vw, 28px);
  bottom: calc(clamp(16px, 3vw, 28px) + env(safe-area-inset-bottom, 0px));
  z-index: 9998;
  display: flex;
  align-items: center;
  gap: 10px;
}
.ssc-launcher {
  position: relative;
  width: 64px; height: 64px; border-radius: 50%;
  border: 0;
  /* Яркий золотой градиент — контрастно на тёмной/фото/светлой подложке. */
  background:
    radial-gradient(circle at 30% 25%, var(--ssc-gold-soft) 0%, var(--ssc-gold) 55%, var(--ssc-gold-deep) 100%);
  color: #1a1405;
  cursor: pointer;
  box-shadow:
    0 14px 36px rgba(217, 178, 106, 0.38),
    0 0 0 3px rgba(217, 178, 106, 0.18),
    inset 0 0 0 1px rgba(255, 255, 255, 0.28);
  display: grid; place-items: center;
  transition: transform .28s cubic-bezier(.34, 1.56, .64, 1), box-shadow .25s ease;
}
.ssc-launcher:hover {
  transform: translateY(-3px) scale(1.04);
  box-shadow:
    0 20px 46px rgba(217, 178, 106, 0.5),
    0 0 0 3px rgba(217, 178, 106, 0.32),
    inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}
.ssc-launcher:active { transform: translateY(-1px) scale(1.01); }
.ssc-launcher svg {
  width: 28px; height: 28px;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.25));
}
.ssc-launcher-ring {
  position: absolute; inset: -6px;
  border-radius: 50%;
  border: 2px solid rgba(217, 178, 106, 0.55);
  pointer-events: none;
  animation: ssc-halo 2.4s ease-out infinite;
}
@keyframes ssc-halo {
  0%   { transform: scale(0.98); opacity: 0.8; }
  70%  { transform: scale(1.35); opacity: 0; }
  100% { transform: scale(1.35); opacity: 0; }
}
.ssc-launcher-dot {
  position: absolute; top: 2px; right: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #e14a4a;
  border: 2px solid var(--ssc-bg);
  animation: ssc-pulse 1.4s ease-in-out infinite;
}
@keyframes ssc-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.18); opacity: 0.78; }
}
/* Плавающий ярлык возле кнопки — не торчит, а раскрывается при hover. */
.ssc-launcher-label {
  max-width: 0;
  overflow: hidden;
  background: linear-gradient(180deg, var(--ssc-panel-2), var(--ssc-panel));
  color: var(--ssc-gold-strong);
  border: 1px solid var(--ssc-line);
  border-radius: 999px;
  padding: 0;
  font-size: 13px; font-weight: 500; letter-spacing: 0.01em;
  white-space: nowrap;
  transition: max-width .35s ease, padding .35s ease, opacity .25s ease;
  opacity: 0;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}
.ssc-launcher-label::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  margin-right: 8px; vertical-align: middle;
  border-radius: 50%;
  background: var(--ssc-green);
  box-shadow: 0 0 8px var(--ssc-green);
}
.ssc-launcher-wrap:hover .ssc-launcher-label,
.ssc-launcher-wrap.ssc-expanded .ssc-launcher-label {
  max-width: 240px;
  padding: 9px 16px 9px 14px;
  opacity: 1;
}

/* ---------- Проактивный нудж: всплывает над лончером через несколько секунд ---------- */
.ssc-nudge {
  position: absolute;
  left: 0;
  bottom: calc(100% + 14px);
  min-width: 240px;
  max-width: 300px;
  background: linear-gradient(180deg, var(--ssc-panel-2), var(--ssc-panel));
  border: 1px solid var(--ssc-line);
  border-radius: 16px;
  padding: 12px 34px 12px 14px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5), 0 0 40px -16px rgba(217, 178, 106, 0.2);
  transform: translateY(8px);
  opacity: 0;
  pointer-events: none;
  transition: transform .3s ease, opacity .3s ease;
}
.ssc-nudge.ssc-nudge-visible {
  transform: translateY(0);
  opacity: 1;
  pointer-events: auto;
}
.ssc-nudge::after {
  content: '';
  position: absolute;
  left: 24px; bottom: -6px;
  width: 10px; height: 10px;
  background: var(--ssc-panel);
  border-right: 1px solid var(--ssc-line);
  border-bottom: 1px solid var(--ssc-line);
  transform: rotate(45deg);
}
.ssc-nudge-title {
  margin: 0 0 4px;
  font-family: "Cormorant Garamond", Georgia, serif;
  font-size: 17px; font-weight: 500; font-style: italic;
  color: var(--ssc-gold-soft);
  letter-spacing: 0.01em;
}
.ssc-nudge-text {
  margin: 0;
  font-size: 12.5px; line-height: 1.5;
  color: var(--ssc-text);
}
.ssc-nudge-close {
  position: absolute;
  top: 6px; right: 6px;
  appearance: none;
  background: transparent; border: 0;
  color: var(--ssc-muted);
  cursor: pointer;
  width: 26px; height: 26px;
  border-radius: 6px;
  font-size: 16px; line-height: 1;
  transition: background .15s ease, color .15s ease;
}
.ssc-nudge-close:hover { background: rgba(255, 255, 255, 0.06); color: var(--ssc-text); }

/* ---------- Панель чата ---------- */
.ssc-panel {
  position: fixed;
  left: clamp(16px, 3vw, 28px);
  bottom: calc(clamp(16px, 3vw, 28px) + 82px + env(safe-area-inset-bottom, 0px));
  width: min(400px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 140px));
  background: var(--ssc-panel);
  border: 1px solid var(--ssc-line);
  border-radius: 20px;
  box-shadow:
    0 40px 80px -20px rgba(0, 0, 0, 0.75),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset,
    0 0 60px -20px rgba(217, 178, 106, 0.18);
  display: none; flex-direction: column;
  overflow: hidden;
  z-index: 9999;
}
.ssc-panel.ssc-open {
  display: flex;
  animation: ssc-slide-in .28s cubic-bezier(.34, 1.2, .64, 1);
  transform-origin: bottom left;
}
@keyframes ssc-slide-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

.ssc-header {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ssc-line);
  background:
    linear-gradient(135deg, rgba(217, 178, 106, 0.14) 0%, rgba(217, 178, 106, 0.02) 50%, transparent 100%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent);
}
.ssc-header::after {
  content: '';
  position: absolute;
  left: 16px; right: 16px; bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ssc-gold) 50%, transparent);
  opacity: 0.5;
}
.ssc-header-badge {
  position: relative;
  width: 40px; height: 40px; border-radius: 50%;
  background:
    radial-gradient(circle at 30% 25%, var(--ssc-gold-soft) 0%, var(--ssc-gold) 55%, var(--ssc-gold-deep) 100%);
  color: #1a1405;
  display: grid; place-items: center;
  font-family: "Cormorant Garamond", Georgia, serif;
  font-size: 18px; font-weight: 600; letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 4px 14px rgba(217, 178, 106, 0.35);
  flex-shrink: 0;
  overflow: hidden;
}
/* Inline SVG-монограмм AlesSanna (italic-A с фирменным росчерком). Лежит
   внутри золотой шайбы, использует currentColor → точная заливка как у
   текста, который был тут раньше. */
.ssc-header-mono {
  width: 100%; height: 100%;
  display: block;
  color: #1a1405;
  filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.18));
}
.ssc-online-dot {
  position: absolute; right: -1px; bottom: -1px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--ssc-green);
  border: 2px solid var(--ssc-panel);
  box-shadow: 0 0 0 2px rgba(82, 216, 154, 0.28);
}
.ssc-header-text { min-width: 0; flex: 1; }
.ssc-header-title {
  font-family: "Cormorant Garamond", Georgia, serif;
  font-size: 18px; font-weight: 500; letter-spacing: 0.02em;
  color: var(--ssc-gold-soft);
  margin: 0;
}
.ssc-header-sub {
  display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; letter-spacing: 0.06em;
  color: var(--ssc-muted);
  margin: 2px 0 0;
  text-transform: uppercase;
}
.ssc-header-sub::before {
  content: '';
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ssc-green);
  box-shadow: 0 0 8px var(--ssc-green);
}
.ssc-close {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: var(--ssc-muted);
  cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center;
  font-size: 20px; line-height: 1;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.ssc-close:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--ssc-text);
  border-color: rgba(255, 255, 255, 0.1);
}
.ssc-body {
  flex: 1; overflow-y: auto;
  padding: 14px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-behavior: smooth;
}
.ssc-form { display: flex; flex-direction: column; gap: 12px; }
.ssc-form-greeting {
  font-family: "Cormorant Garamond", Georgia, serif;
  font-size: 19px; font-weight: 400; font-style: italic;
  color: var(--ssc-gold-soft);
  margin: 0 0 4px;
  letter-spacing: 0.01em;
}
.ssc-field { display: flex; flex-direction: column; gap: 5px; }
.ssc-label {
  font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ssc-muted); font-weight: 600;
}
.ssc-input, .ssc-textarea {
  width: 100%;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--ssc-text);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  transition: border-color .15s ease, background .15s ease;
}
.ssc-input:focus, .ssc-textarea:focus {
  border-color: var(--ssc-gold);
  background: rgba(198,167,90,0.04);
}
.ssc-textarea { resize: vertical; min-height: 72px; }
.ssc-topic-group { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ssc-topic {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 11px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
  text-align: left;
}
.ssc-topic:hover { border-color: rgba(198,167,90,0.4); }
.ssc-topic.ssc-selected {
  border-color: var(--ssc-gold);
  background: rgba(198,167,90,0.08);
}
.ssc-topic-title { font-size: 12.5px; font-weight: 600; color: var(--ssc-text); }
.ssc-topic-sub { font-size: 10.5px; color: var(--ssc-muted); }
.ssc-btn {
  appearance: none;
  border: 1px solid var(--ssc-gold);
  background: linear-gradient(180deg, rgba(198,167,90,0.18), rgba(198,167,90,0.06));
  color: var(--ssc-gold-soft);
  border-radius: 10px;
  padding: 11px 14px;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.ssc-btn:hover { background: var(--ssc-gold); color: #1a1505; }
.ssc-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ssc-error {
  font-size: 12px;
  color: #ef8a8a;
  background: rgba(239, 138, 138, 0.08);
  border: 1px solid rgba(239, 138, 138, 0.25);
  border-radius: 8px;
  padding: 8px 10px;
}
.ssc-info {
  font-size: 11.5px;
  color: var(--ssc-muted);
  text-align: center;
  padding: 6px 8px;
}
.ssc-msg { display: flex; }
.ssc-msg.visitor { justify-content: flex-end; }
.ssc-bubble {
  max-width: 85%;
  padding: 9px 12px 8px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.4;
  word-break: break-word;
}
.ssc-bubble a { color: inherit; text-decoration: underline; }
.ssc-msg.visitor .ssc-bubble {
  background: linear-gradient(180deg, rgba(198,167,90,0.22), rgba(198,167,90,0.12));
  border: 1px solid rgba(198,167,90,0.35);
  color: #f5ecd4;
  border-bottom-right-radius: 4px;
}
.ssc-msg.staff .ssc-bubble {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--ssc-text);
  border-bottom-left-radius: 4px;
}
.ssc-meta {
  font-size: 10px;
  color: var(--ssc-muted);
  margin-top: 3px;
  opacity: 0.75;
}
/* «Печатает…» — лёгкий «staff»-пузырёк с тремя точками. Появляется после
   отправки сообщения посетителем и пропадает, когда приходит ответ
   сотрудника или истекает таймаут (см. showTyping/hideTyping в JS). */
.ssc-typing {
  display: flex; justify-content: flex-start;
  margin-top: -4px;
  opacity: 0;
  transform: translateY(2px);
  transition: opacity .22s ease, transform .22s ease;
  pointer-events: none;
}
.ssc-typing.is-on { opacity: 1; transform: translateY(0); }
.ssc-typing-bubble {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  border-bottom-left-radius: 4px;
  padding: 9px 12px 8px;
}
.ssc-typing-dots { display: inline-flex; gap: 4px; align-items: center; }
.ssc-typing-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ssc-gold-soft);
  opacity: 0.42;
  animation: ssc-typing-bounce 1.25s ease-in-out infinite;
}
.ssc-typing-dot:nth-child(2) { animation-delay: .16s; }
.ssc-typing-dot:nth-child(3) { animation-delay: .32s; }
@keyframes ssc-typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.42; }
  40%           { transform: translateY(-3px); opacity: 1; }
}
.ssc-typing-label {
  font-size: 10.5px; letter-spacing: 0.04em;
  color: var(--ssc-muted);
  text-transform: lowercase;
}
.ssc-attach-preview {
  margin-top: 6px;
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px;
  text-decoration: none;
  color: inherit;
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  padding: 5px 8px;
  max-width: 100%;
}
.ssc-attach-img {
  display: block;
  max-width: 100%; max-height: 220px;
  border-radius: 10px;
  margin-top: 4px;
}
.ssc-footer {
  border-top: 1px solid var(--ssc-line);
  padding: 10px 12px;
  background: rgba(0,0,0,0.3);
}
.ssc-reply-row { display: flex; align-items: flex-end; gap: 8px; }
.ssc-reply {
  flex: 1;
  resize: none;
  min-height: 38px; max-height: 140px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 9px 12px;
  color: var(--ssc-text);
  font: inherit; font-size: 13.5px;
  outline: none;
}
.ssc-reply:focus { border-color: var(--ssc-gold); }
.ssc-attach-btn, .ssc-send-btn {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  color: var(--ssc-muted);
  width: 38px; height: 38px;
  display: grid; place-items: center;
  cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease;
  flex-shrink: 0;
}
.ssc-attach-btn:hover { color: var(--ssc-text); border-color: rgba(255,255,255,0.25); }
.ssc-send-btn {
  border-color: var(--ssc-gold);
  color: var(--ssc-gold-soft);
  background: linear-gradient(180deg, rgba(198,167,90,0.2), rgba(198,167,90,0.08));
}
.ssc-send-btn:hover { background: var(--ssc-gold); color: #1a1505; }
.ssc-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ssc-attach-chip {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: var(--ssc-text);
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 4px 8px;
  margin-bottom: 6px;
  max-width: 100%;
}
.ssc-attach-chip button {
  appearance: none; background: transparent; border: none;
  color: var(--ssc-muted); cursor: pointer; padding: 0 2px;
  font-size: 14px; line-height: 1;
}
.ssc-footer-note {
  font-size: 10px; color: var(--ssc-muted);
  margin: 6px 0 0; letter-spacing: 0.02em;
  text-align: center;
}
.ssc-reset {
  appearance: none; background: transparent; border: none;
  color: var(--ssc-muted); font-size: 11px; cursor: pointer;
  margin-left: auto; padding: 0;
  text-decoration: underline; text-underline-offset: 3px;
}
.ssc-reset:hover { color: var(--ssc-text); }
.ssc-status-pill {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 3px 8px; border-radius: 999px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--ssc-muted);
  background: rgba(255,255,255,0.03);
}
.ssc-status-pill.open { color: #9ce4a7; border-color: rgba(156, 228, 167, 0.3); background: rgba(156,228,167,0.06); }
.ssc-status-pill.pending { color: #e8c97a; border-color: rgba(232,201,122,0.3); background: rgba(232,201,122,0.06); }
.ssc-status-pill.closed { color: #ef8a8a; border-color: rgba(239,138,138,0.3); background: rgba(239,138,138,0.06); }

@media (max-width: 480px) {
  .ssc-launcher-wrap {
    left: 14px;
    bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  }
  .ssc-panel {
    left: 8px; right: 8px; width: auto;
    bottom: calc(90px + env(safe-area-inset-bottom, 0px));
    max-height: calc(100vh - 120px);
    border-radius: 18px;
  }
  .ssc-nudge { max-width: calc(100vw - 48px); }
  /* На мобильном label держим свёрнутым — места мало, нудж и так привлекает. */
  .ssc-launcher-wrap:hover .ssc-launcher-label { max-width: 0; padding: 0; opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ssc-launcher-ring,
  .ssc-launcher-dot,
  .ssc-typing-dot { animation: none; }
  .ssc-panel.ssc-open { animation: none; }
  .ssc-launcher,
  .ssc-launcher-label,
  .ssc-nudge,
  .ssc-typing { transition: none; }
}
`;
  document.head.appendChild(style);
}

/** Собираем обёртку с кнопкой, раскрывающимся лейблом и скрытым проактивным нуджем.
 *  Экспортируем ссылки на ключевые элементы в `dataset` через querySelector — чтобы
 *  initSupportChat() мог цепляться без лишней возни. */
function makeLauncher() {
  const wrap = document.createElement("div");
  wrap.className = "ssc-launcher-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ssc-launcher";
  btn.setAttribute("aria-label", L.launcherLabel);
  btn.innerHTML = `
    <span class="ssc-launcher-ring" aria-hidden="true"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5c0 4.142-4.03 7.5-9 7.5-1.05 0-2.06-.155-3-.44L4.5 20l.9-3.5C4.53 15.3 4 13.46 4 11.5 4 7.358 8.03 4 13 4s8 3.358 8 7.5z"/>
      <path d="M9 11h.01M13 11h.01M17 11h.01" stroke-width="2.2"/>
    </svg>
    <span class="ssc-launcher-dot" aria-hidden="true" style="display:none"></span>
  `;

  const label = document.createElement("span");
  label.className = "ssc-launcher-label";
  label.textContent = L.launcherTeaser;
  label.setAttribute("aria-hidden", "true");

  const nudge = document.createElement("div");
  nudge.className = "ssc-nudge";
  nudge.setAttribute("role", "status");
  nudge.setAttribute("aria-live", "polite");
  nudge.innerHTML = `
    <button type="button" class="ssc-nudge-close" aria-label="${escapeHtml(L.nudgeClose)}">×</button>
    <p class="ssc-nudge-title">${escapeHtml(L.nudgeTitle)}</p>
    <p class="ssc-nudge-text">${escapeHtml(L.nudgeText)}</p>
  `;

  wrap.appendChild(btn);
  wrap.appendChild(label);
  wrap.appendChild(nudge);
  return wrap;
}

function renderForm(widget) {
  const profile = getProfile() || {};
  const topic = profile.lastTopic || "salon";
  widget.body.innerHTML = `
    <p class="ssc-form-greeting">${L.welcome}</p>
    <form class="ssc-form" novalidate>
      <div class="ssc-field">
        <label class="ssc-label" for="ssc-name">${L.nameLabel}</label>
        <input id="ssc-name" class="ssc-input" type="text" maxlength="120"
          autocomplete="given-name" placeholder="${L.namePh}"
          value="${escapeHtml(profile.name || "")}" required />
      </div>
      <div class="ssc-field">
        <label class="ssc-label" for="ssc-email">${L.emailLabel}</label>
        <input id="ssc-email" class="ssc-input" type="email" maxlength="200"
          autocomplete="email" placeholder="${L.emailPh}"
          value="${escapeHtml(profile.email || "")}" />
      </div>
      <div class="ssc-field">
        <span class="ssc-label">${L.topicLabel}</span>
        <div class="ssc-topic-group" role="radiogroup">
          <button type="button" class="ssc-topic ${topic === "salon" ? "ssc-selected" : ""}" data-topic="salon" role="radio" aria-checked="${topic === "salon"}">
            <span class="ssc-topic-title">${L.topicSalon}</span>
            <span class="ssc-topic-sub">${L.topicSalonSub}</span>
          </button>
          <button type="button" class="ssc-topic ${topic === "site" ? "ssc-selected" : ""}" data-topic="site" role="radio" aria-checked="${topic === "site"}">
            <span class="ssc-topic-title">${L.topicSite}</span>
            <span class="ssc-topic-sub">${L.topicSiteSub}</span>
          </button>
        </div>
      </div>
      <div class="ssc-field">
        <label class="ssc-label" for="ssc-msg">${L.messageLabel}</label>
        <textarea id="ssc-msg" class="ssc-textarea" maxlength="4000" placeholder="${L.messagePh}" required></textarea>
      </div>
      <div class="ssc-error" data-err hidden></div>
      <button type="submit" class="ssc-btn">${L.start}</button>
      <p class="ssc-footer-note">${L.poweredBy}</p>
    </form>
  `;
  const form = widget.body.querySelector("form");
  const topicBtns = widget.body.querySelectorAll(".ssc-topic");
  let selectedTopic = topic;
  topicBtns.forEach((b) => {
    b.addEventListener("click", () => {
      selectedTopic = b.getAttribute("data-topic") || "salon";
      topicBtns.forEach((x) => {
        const sel = x.getAttribute("data-topic") === selectedTopic;
        x.classList.toggle("ssc-selected", sel);
        x.setAttribute("aria-checked", String(sel));
      });
    });
  });
  const errEl = widget.body.querySelector("[data-err]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const name = form.querySelector("#ssc-name").value.trim();
    const email = form.querySelector("#ssc-email").value.trim();
    const message = form.querySelector("#ssc-msg").value.trim();
    if (!name) {
      errEl.textContent = L.nameRequired;
      errEl.hidden = false;
      return;
    }
    if (!message) {
      errEl.textContent = L.messageRequired;
      errEl.hidden = false;
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = L.starting;
    try {
      const { error } = await widget.sb.rpc("support_visitor_start_thread", {
        p_session_token: widget.sessionToken,
        p_topic: selectedTopic,
        p_name: name,
        p_email: email || null,
        p_message: message,
        p_user_agent: (navigator.userAgent || "").slice(0, 500),
        p_origin_url: String(location.href || "").slice(0, 500),
      });
      if (error) throw error;
      saveProfile({ name, email: email || null, lastTopic: selectedTopic });
      savePersistedState({ hasThread: true });
      await refreshThread(widget);
      renderThread(widget);
    } catch (err) {
      log("start error", err);
      errEl.textContent = L.err;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = L.start;
    }
  });
}

function renderThread(widget) {
  widget.body.innerHTML = `<div class="ssc-thread" data-thread></div>`;
  renderMessages(widget);
  renderFooter(widget);
  scrollToBottom(widget);
}

/* «Поддержка печатает…» — честный, но мягкий индикатор: показываем после
 * того как посетитель отправил сообщение, и скрываем как только пришёл
 * новый ответ от сотрудника или истёк MAX_TYPING_MS (страховка, чтобы
 * не висел вечно, если админа нет на месте). */
const MAX_TYPING_MS = 8000;
function showTyping(widget) {
  if (!widget) return;
  if (widget.typingTimer) {
    clearTimeout(widget.typingTimer);
    widget.typingTimer = null;
  }
  widget.state.typing = true;
  renderMessages(widget);
  scrollToBottom(widget);
  widget.typingTimer = setTimeout(() => {
    hideTyping(widget);
  }, MAX_TYPING_MS);
}
function hideTyping(widget) {
  if (!widget) return;
  if (widget.typingTimer) {
    clearTimeout(widget.typingTimer);
    widget.typingTimer = null;
  }
  if (!widget.state.typing) return;
  widget.state.typing = false;
  renderMessages(widget);
}

function renderMessages(widget) {
  const holder = widget.body.querySelector("[data-thread]");
  if (!holder) return;
  const { thread, messages } = widget.state;
  if (!messages || messages.length === 0) {
    holder.innerHTML = `<p class="ssc-info">${L.emptyThread}</p>`;
    return;
  }
  const statusPill =
    thread && thread.status
      ? `<span class="ssc-status-pill ${thread.status}" aria-hidden="true">${
          thread.status === "open" ? "● " : thread.status === "pending" ? "… " : "× "
        }${
          thread.status === "open"
            ? (detectLang() === "et" ? "avatud" : "открыт")
            : thread.status === "pending"
              ? (detectLang() === "et" ? "ootel" : "в ожидании")
              : (detectLang() === "et" ? "suletud" : "закрыт")
        }</span>`
      : "";
  let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">${statusPill}<button type="button" class="ssc-reset" data-reset>${L.resetThread}</button></div>`;
  if (thread && thread.status === "closed") {
    html += `<div class="ssc-info">${L.statusClosed}</div>`;
  }
  for (const m of messages) {
    const who = m.sender_type === "staff" ? "staff" : "visitor";
    const senderName =
      m.sender_type === "staff"
        ? (m.sender_staff_name || L.support)
        : L.you;
    const time = formatTime(m.created_at);
    let attachHtml = "";
    if (m.attachment_url) {
      const isImg = (m.attachment_mime || "").startsWith("image/");
      attachHtml = isImg
        ? `<a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noreferrer"><img class="ssc-attach-img" src="${escapeHtml(m.attachment_url)}" alt="${escapeHtml(m.attachment_name || "")}"></a>`
        : `<a class="ssc-attach-preview" href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noreferrer">📎 <span>${escapeHtml(m.attachment_name || L.attach)}</span></a>`;
    }
    const body = m.body ? linkify(m.body).replace(/\n/g, "<br>") : "";
    html += `
      <div class="ssc-msg ${who}">
        <div class="ssc-bubble">
          ${body ? `<div>${body}</div>` : ""}
          ${attachHtml}
          <div class="ssc-meta">${escapeHtml(senderName)} · ${escapeHtml(time)}</div>
        </div>
      </div>
    `;
  }
  /* Индикатор «поддержка печатает…». Не рендерим, если тред закрыт —
   * там нет смысла ждать ответа. */
  if (widget.state.typing && thread && thread.status !== "closed") {
    html += `
      <div class="ssc-typing is-on" data-typing>
        <div class="ssc-typing-bubble">
          <span class="ssc-typing-dots" aria-hidden="true">
            <span class="ssc-typing-dot"></span>
            <span class="ssc-typing-dot"></span>
            <span class="ssc-typing-dot"></span>
          </span>
          <span class="ssc-typing-label">${escapeHtml(L.typing || "")}</span>
        </div>
      </div>
    `;
  }
  holder.innerHTML = html;
  const resetBtn = holder.querySelector("[data-reset]");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm(L.resetConfirm)) return;
      // New session token; keep profile so name remains pre-filled
      writeLS(STORAGE_SESSION, null);
      widget.sessionToken = getOrCreateSessionToken();
      savePersistedState({ hasThread: false });
      if (widget.typingTimer) {
        clearTimeout(widget.typingTimer);
        widget.typingTimer = null;
      }
      widget.state = { thread: null, messages: [], lastFetchAt: null, typing: false };
      renderForm(widget);
    });
  }
}

function renderFooter(widget) {
  // Footer is rendered once per thread-mode session
  if (widget.footer.dataset.mode === "thread") return;
  widget.footer.innerHTML = `
    <div class="ssc-attach-chip" data-chip hidden>
      <span>📎</span>
      <span data-chip-name style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <button type="button" data-chip-remove aria-label="remove">×</button>
    </div>
    <div class="ssc-reply-row">
      <label class="ssc-attach-btn" title="${L.attach}">
        📎
        <input type="file" style="display:none" data-file>
      </label>
      <textarea class="ssc-reply" placeholder="${L.replyPh}" rows="1" maxlength="4000" data-reply></textarea>
      <button type="button" class="ssc-send-btn" data-send title="${L.send}" aria-label="${L.send}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
    <p class="ssc-footer-note">${L.hintEnter}</p>
  `;
  widget.footer.dataset.mode = "thread";

  const replyEl = widget.footer.querySelector("[data-reply]");
  const sendBtn = widget.footer.querySelector("[data-send]");
  const fileInput = widget.footer.querySelector("[data-file]");
  const chip = widget.footer.querySelector("[data-chip]");
  const chipName = widget.footer.querySelector("[data-chip-name]");
  const chipRemove = widget.footer.querySelector("[data-chip-remove]");

  const autoresize = () => {
    replyEl.style.height = "auto";
    replyEl.style.height = Math.min(140, replyEl.scrollHeight) + "px";
  };
  replyEl.addEventListener("input", autoresize);
  replyEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  chipRemove.addEventListener("click", () => {
    widget.pendingFile = null;
    fileInput.value = "";
    chip.hidden = true;
  });

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_ATTACHMENT_BYTES) {
      alert(L.attachTooLarge);
      fileInput.value = "";
      return;
    }
    widget.pendingFile = f;
    chipName.textContent = f.name;
    chip.hidden = false;
  });

  async function doSend() {
    const body = replyEl.value.trim();
    if (!body && !widget.pendingFile) return;
    sendBtn.disabled = true;
    try {
      let att = null;
      if (widget.pendingFile) {
        att = await uploadAttachment(widget, widget.pendingFile);
      }
      const { error } = await widget.sb.rpc("support_visitor_post_message", {
        p_session_token: widget.sessionToken,
        p_body: body,
        p_attachment_url: att ? att.url : null,
        p_attachment_name: att ? att.name : null,
        p_attachment_mime: att ? att.mime : null,
        p_attachment_size_bytes: att ? att.size : null,
      });
      if (error) throw error;
      replyEl.value = "";
      autoresize();
      widget.pendingFile = null;
      fileInput.value = "";
      chip.hidden = true;
      await refreshThread(widget);
      renderMessages(widget);
      scrollToBottom(widget);
      /* Покажем «печатает…» — это даёт ощущение «нас услышали и сейчас
       * ответят». Если придёт реальный ответ от сотрудника, refreshThread
       * сам погасит индикатор; иначе спрячется через MAX_TYPING_MS. */
      showTyping(widget);
    } catch (err) {
      log("send error", err);
      alert(L.err);
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", doSend);
}

async function uploadAttachment(widget, file) {
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 10) || "bin";
  const key = `${widget.sessionToken}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await widget.sb.storage.from(BUCKET).upload(key, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    log("upload error", error);
    throw new Error(L.attachErr);
  }
  const pub = widget.sb.storage.from(BUCKET).getPublicUrl(key);
  return {
    url: pub.data.publicUrl,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

function scrollToBottom(widget) {
  requestAnimationFrame(() => {
    widget.body.scrollTop = widget.body.scrollHeight;
  });
}

async function refreshThread(widget) {
  try {
    const { data, error } = await widget.sb.rpc("support_visitor_fetch", {
      p_session_token: widget.sessionToken,
      p_since_iso: null,
    });
    if (error) throw error;
    const payload = data || { thread: null, messages: [] };
    const prevCount = widget.state.messages ? widget.state.messages.length : 0;
    const prevTyping = !!(widget.state && widget.state.typing);
    widget.state = {
      thread: payload.thread || null,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      lastFetchAt: new Date().toISOString(),
      typing: prevTyping,
    };
    const hasNewStaff =
      widget.state.messages.length > prevCount &&
      widget.state.messages[widget.state.messages.length - 1]?.sender_type === "staff";
    if (hasNewStaff && !widget.isOpen) {
      widget.showDot(true);
    }
    /* Реальный ответ — гасим «печатает…» немедленно, не дожидаясь таймаута. */
    if (hasNewStaff) hideTyping(widget);
    return hasNewStaff;
  } catch (err) {
    log("fetch error", err);
    return false;
  }
}

function setupPolling(widget) {
  if (widget.pollTimer) clearInterval(widget.pollTimer);
  const run = () => {
    if (!widget.state || !widget.state.thread) return;
    refreshThread(widget).then((hasNew) => {
      if (widget.isOpen) {
        renderMessages(widget);
        if (hasNew) scrollToBottom(widget);
        if (widget.isOpen && widget.sessionToken) {
          widget.sb
            .rpc("support_visitor_mark_read", { p_session_token: widget.sessionToken })
            .then(() => {})
            .catch(() => {});
        }
      }
    });
  };
  widget.pollTimer = setInterval(run, widget.isOpen ? POLL_OPEN_MS : POLL_CLOSED_MS);
}

function openPanel(widget) {
  widget.panel.classList.add("ssc-open");
  widget.isOpen = true;
  widget.showDot(false);
  const state = getPersistedState();
  if (state.hasThread) {
    renderThread(widget);
    refreshThread(widget).then(() => {
      renderMessages(widget);
      scrollToBottom(widget);
      widget.sb
        .rpc("support_visitor_mark_read", { p_session_token: widget.sessionToken })
        .then(() => {})
        .catch(() => {});
    });
  } else {
    renderForm(widget);
  }
  setupPolling(widget);
}

function closePanel(widget) {
  widget.panel.classList.remove("ssc-open");
  widget.isOpen = false;
  setupPolling(widget);
}

export function initSupportChat() {
  if (document.getElementById("ssc-root")) return;
  const cfg = getCfg();
  if (!cfg) {
    log("supabase config missing, widget disabled");
    return;
  }
  injectStyles();

  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const root = document.createElement("div");
  root.id = "ssc-root";
  root.className = "ssc-root";
  root.setAttribute("lang", detectLang());

  const launcherWrap = makeLauncher();
  const launcherBtn = launcherWrap.querySelector(".ssc-launcher");
  const dotEl = launcherWrap.querySelector(".ssc-launcher-dot");
  const nudgeEl = launcherWrap.querySelector(".ssc-nudge");
  const nudgeCloseEl = launcherWrap.querySelector(".ssc-nudge-close");

  const panel = document.createElement("div");
  panel.className = "ssc-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", L.headerTitle);
  panel.innerHTML = `
    <header class="ssc-header">
      <div class="ssc-header-badge" aria-hidden="true">
        <svg class="ssc-header-mono" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <text x="20" y="29"
            text-anchor="middle"
            font-family="'Cormorant Garamond','Playfair Display',Georgia,serif"
            font-size="26" font-style="italic" font-weight="500"
            fill="currentColor">A</text>
          <path d="M9 33.5 Q20 36.5 31 33.5"
            fill="none" stroke="currentColor"
            stroke-width="0.85" stroke-linecap="round"
            opacity="0.55"/>
        </svg>
        <span class="ssc-online-dot" aria-hidden="true"></span>
      </div>
      <div class="ssc-header-text">
        <p class="ssc-header-title">${L.headerTitle}</p>
        <p class="ssc-header-sub">${L.headerSub}</p>
      </div>
      <button type="button" class="ssc-close" aria-label="${L.close}">×</button>
    </header>
    <div class="ssc-body" data-body></div>
    <div class="ssc-footer" data-footer></div>
  `;

  const widget = {
    sb,
    sessionToken: getOrCreateSessionToken(),
    panel,
    launcher: launcherBtn,
    launcherWrap,
    body: panel.querySelector("[data-body]"),
    footer: panel.querySelector("[data-footer]"),
    state: { thread: null, messages: [], lastFetchAt: null, typing: false },
    isOpen: false,
    pollTimer: null,
    typingTimer: null,
    pendingFile: null,
    showDot(on) {
      if (!dotEl) return;
      dotEl.style.display = on ? "block" : "none";
    },
  };

  /* Проактивный нудж: показываем один раз в сессию через 7 секунд, если посетитель
   * ещё не открыл чат и у него нет незакрытого диалога. Скрываем при любом клике
   * по кнопке закрытия, клике по лончеру или открытии панели. */
  const NUDGE_KEY = "ssc_nudge_shown_v1";
  let nudgeTimer = null;
  function hideNudge() {
    if (nudgeEl) nudgeEl.classList.remove("ssc-nudge-visible");
    if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
  }
  function scheduleNudge() {
    try {
      if (sessionStorage.getItem(NUDGE_KEY) === "1") return;
    } catch (_) { /* ignore */ }
    nudgeTimer = setTimeout(() => {
      if (widget.isOpen) return;
      if (!nudgeEl) return;
      nudgeEl.classList.add("ssc-nudge-visible");
      try { sessionStorage.setItem(NUDGE_KEY, "1"); } catch (_) { /* ignore */ }
    }, 7000);
  }

  launcherBtn.addEventListener("click", () => {
    hideNudge();
    if (widget.isOpen) closePanel(widget);
    else openPanel(widget);
  });
  if (nudgeCloseEl) {
    nudgeCloseEl.addEventListener("click", (e) => {
      e.stopPropagation();
      hideNudge();
      try { sessionStorage.setItem(NUDGE_KEY, "1"); } catch (_) { /* ignore */ }
    });
  }
  panel.querySelector(".ssc-close").addEventListener("click", () => closePanel(widget));

  document.body.appendChild(launcherWrap);
  document.body.appendChild(panel);
  document.body.appendChild(root);

  // If visitor already has a thread, do an initial silent fetch to know
  // whether there's a new staff reply since last close → show red dot.
  const state = getPersistedState();
  if (state.hasThread) {
    refreshThread(widget).then(() => {
      const t = widget.state.thread;
      if (t && t.unread_for_visitor) widget.showDot(true);
      setupPolling(widget);
    });
  } else {
    scheduleNudge();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSupportChat, { once: true });
  } else {
    initSupportChat();
  }
}
