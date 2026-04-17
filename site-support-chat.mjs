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
    headerTitle: "AlesSanna · поддержка",
    headerSub: "напишите нам · обычно отвечаем в течение часа",
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
    emptyThread: "Начните переписку.",
    hintEnter: "Enter — отправить · Shift+Enter — перенос",
    resetThread: "Начать новый диалог",
    resetConfirm: "Начать новый диалог? Текущая переписка скроется.",
    statusClosed: "Диалог закрыт сотрудником. Напишите сообщение, чтобы открыть снова.",
    poweredBy: "Защищённый чат · ваши сообщения видит только команда AlesSanna",
  },
  et: {
    launcherLabel: "Kirjuta tugiteenusele",
    headerTitle: "AlesSanna · tugi",
    headerSub: "kirjuta meile · vastame tavaliselt tunni jooksul",
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
  --ssc-gold: #c6a75a;
  --ssc-gold-soft: #d8bc74;
  --ssc-bg: #0b0b0e;
  --ssc-panel: #121217;
  --ssc-line: rgba(198, 167, 90, 0.18);
  --ssc-text: #e9e5db;
  --ssc-muted: #8d8a83;
  --ssc-accent: #c6a75a;
  position: fixed; inset: auto 0 0 auto; z-index: 9998;
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ssc-text);
}
.ssc-launcher {
  position: fixed;
  right: clamp(14px, 3vw, 28px);
  bottom: clamp(14px, 3vw, 28px);
  width: 58px; height: 58px; border-radius: 50%;
  border: 1px solid rgba(198, 167, 90, 0.55);
  background: radial-gradient(circle at 30% 30%, #1a1a22 0%, #0b0b0e 70%);
  color: var(--ssc-gold);
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(198,167,90,0.15) inset;
  display: flex; align-items: center; justify-content: center;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
  z-index: 9998;
}
.ssc-launcher:hover { transform: translateY(-2px); border-color: var(--ssc-gold); }
.ssc-launcher svg { width: 26px; height: 26px; }
.ssc-launcher-dot {
  position: absolute; top: 6px; right: 6px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #e14a4a; border: 2px solid var(--ssc-bg);
  animation: ssc-pulse 1.6s ease-in-out infinite;
}
@keyframes ssc-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.75; }
}
.ssc-panel {
  position: fixed;
  right: clamp(14px, 3vw, 28px);
  bottom: calc(clamp(14px, 3vw, 28px) + 72px);
  width: min(380px, calc(100vw - 28px));
  max-height: min(640px, calc(100vh - 120px));
  background: var(--ssc-panel);
  border: 1px solid var(--ssc-line);
  border-radius: 18px;
  box-shadow: 0 30px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.02) inset;
  display: none; flex-direction: column;
  overflow: hidden;
  z-index: 9999;
}
.ssc-panel.ssc-open { display: flex; animation: ssc-fade-in .18s ease-out; }
@keyframes ssc-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.ssc-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ssc-line);
  background: linear-gradient(180deg, rgba(198,167,90,0.06), transparent);
}
.ssc-header-badge {
  width: 34px; height: 34px; border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #2a2219 0%, #0b0b0e 70%);
  border: 1px solid rgba(198,167,90,0.4);
  display: grid; place-items: center;
  color: var(--ssc-gold);
  font-size: 14px; letter-spacing: 0.04em;
}
.ssc-header-text { min-width: 0; flex: 1; }
.ssc-header-title {
  font-family: "Cormorant Garamond", Georgia, serif;
  font-size: 17px; font-weight: 500; letter-spacing: 0.02em;
  color: var(--ssc-gold-soft);
  margin: 0;
}
.ssc-header-sub {
  font-size: 10.5px; letter-spacing: 0.02em;
  color: var(--ssc-muted);
  margin: 2px 0 0;
  text-transform: uppercase;
}
.ssc-close {
  appearance: none; background: transparent; border: none;
  color: var(--ssc-muted); cursor: pointer;
  width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center;
  font-size: 18px;
  transition: background .15s ease, color .15s ease;
}
.ssc-close:hover { background: rgba(255,255,255,0.05); color: var(--ssc-text); }
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
  .ssc-panel {
    right: 8px; left: 8px; width: auto;
    bottom: 80px;
    max-height: calc(100vh - 100px);
  }
}
`;
  document.head.appendChild(style);
}

function makeLauncher() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ssc-launcher";
  btn.setAttribute("aria-label", L.launcherLabel);
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12c0 4.418-4.03 8-9 8-1.2 0-2.35-.21-3.4-.59L3 21l1.74-4.55C3.64 15.17 3 13.64 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
    </svg>
    <span class="ssc-launcher-dot" style="display:none"></span>
  `;
  return btn;
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
  holder.innerHTML = html;
  const resetBtn = holder.querySelector("[data-reset]");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm(L.resetConfirm)) return;
      // New session token; keep profile so name remains pre-filled
      writeLS(STORAGE_SESSION, null);
      widget.sessionToken = getOrCreateSessionToken();
      savePersistedState({ hasThread: false });
      widget.state = { thread: null, messages: [], lastFetchAt: null };
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
    widget.state = {
      thread: payload.thread || null,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      lastFetchAt: new Date().toISOString(),
    };
    const hasNewStaff =
      widget.state.messages.length > prevCount &&
      widget.state.messages[widget.state.messages.length - 1]?.sender_type === "staff";
    if (hasNewStaff && !widget.isOpen) {
      widget.showDot(true);
    }
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

  const launcher = makeLauncher();
  const dotEl = launcher.querySelector(".ssc-launcher-dot");

  const panel = document.createElement("div");
  panel.className = "ssc-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", L.headerTitle);
  panel.innerHTML = `
    <header class="ssc-header">
      <div class="ssc-header-badge" aria-hidden="true">A</div>
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
    launcher,
    body: panel.querySelector("[data-body]"),
    footer: panel.querySelector("[data-footer]"),
    state: { thread: null, messages: [], lastFetchAt: null },
    isOpen: false,
    pollTimer: null,
    pendingFile: null,
    showDot(on) {
      if (!dotEl) return;
      dotEl.style.display = on ? "block" : "none";
    },
  };

  launcher.addEventListener("click", () => {
    if (widget.isOpen) closePanel(widget);
    else openPanel(widget);
  });
  panel.querySelector(".ssc-close").addEventListener("click", () => closePanel(widget));

  document.body.appendChild(launcher);
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
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSupportChat, { once: true });
  } else {
    initSupportChat();
  }
}
