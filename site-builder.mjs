import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Singleton Supabase client for the public landing.
 * Несколько .mjs модулей (site-builder, site-services, site-team, site-support-chat)
 * раньше каждый создавали свой createClient — браузер ругался
 * "Multiple GoTrueClient instances detected". Теперь все берут один и тот же
 * экземпляр из globalThis.__alessannaPublicSb.
 */
function getSb(url, key) {
  const slot = "__alessannaPublicSb";
  const cached = globalThis[slot];
  if (cached && cached.__url === url && cached.__key === key) return cached.client;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  globalThis[slot] = { client, __url: url, __key: key };
  return client;
}

function cfg() {
  const sc = globalThis.SUPABASE_CONFIG;
  let url = sc && String(sc.url || "").trim() ? String(sc.url).trim() : "";
  let key = sc && String(sc.anonKey || "").trim() ? String(sc.anonKey).trim() : "";
  try {
    const im = typeof import.meta !== "undefined" && import.meta.env;
    if (im) {
      if (!url) url = String(im.VITE_SUPABASE_URL || "").trim();
      if (!key) key = String(im.VITE_SUPABASE_ANON_KEY || "").trim();
    }
  } catch (_) {
    /* no-op */
  }
  if (!url) url = String(globalThis.SALON_SUPABASE_URL || globalThis.VITE_SUPABASE_URL || "").trim();
  if (!key) key = String(globalThis.SALON_SUPABASE_ANON_KEY || globalThis.VITE_SUPABASE_ANON_KEY || "").trim();
  return { url: url.replace(/\/+$/, ""), key };
}

function pageSlug() {
  const q = new URLSearchParams(window.location.search).get("page");
  if (q && q.trim()) return q.trim();
  const p = window.location.pathname.toLowerCase();
  if (p.endsWith("/ru.html")) return "home-ru";
  return "home-ru";
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeImgSrc(src) {
  const s = String(src || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s, window.location.origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return "";
  }
}

function applyPageStyles(mount, pageRow) {
  const st = pageRow?.styles && typeof pageRow.styles === "object" ? pageRow.styles : {};
  const bodyFont = String(st.bodyFont ?? "Inter");
  const maxW = toNum(st.maxWidth, 960);
  mount.style.maxWidth = `${maxW}px`;
  mount.style.marginLeft = "auto";
  mount.style.marginRight = "auto";
  mount.style.fontFamily = bodyFont;
}

function renderButton(content, blockStyles) {
  const label = String(content?.label ?? "Button");
  const action = String(content?.action ?? "scroll");
  const target = String(content?.target ?? "");
  const wrap = document.createElement("div");
  wrap.className = "site-builder-item";
  const bs = blockStyles && typeof blockStyles === "object" ? blockStyles : {};
  wrap.style.padding = `${toNum(bs.padding, 0)}px`;
  wrap.style.textAlign = String(bs.align ?? "left");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-outline";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (action === "scroll" && target) {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  wrap.appendChild(btn);
  return wrap;
}

function renderText(content, blockStyles, pageStyles) {
  const txt = String(content?.text ?? "");
  const p = document.createElement("p");
  p.className = "section-lead";
  p.textContent = txt;
  const bs = blockStyles && typeof blockStyles === "object" ? blockStyles : {};
  const ps = pageStyles && typeof pageStyles === "object" ? pageStyles : {};
  p.style.fontFamily = String(ps.bodyFont ?? "Inter");
  p.style.fontSize = `${toNum(bs.fontSize, 18)}px`;
  p.style.fontWeight = String(toNum(bs.fontWeight, 400));
  p.style.color = String(bs.color ?? "");
  p.style.textAlign = String(bs.align ?? "left");
  p.style.padding = `${toNum(bs.padding, 0)}px`;
  p.style.margin = "0";
  return p;
}

function renderSection(content, blockStyles, pageStyles) {
  const title = String(content?.title ?? "");
  const text = String(content?.text ?? "");
  const box = document.createElement("div");
  box.className = "gift-card";
  const bs = blockStyles && typeof blockStyles === "object" ? blockStyles : {};
  const ps = pageStyles && typeof pageStyles === "object" ? pageStyles : {};
  const headingFont = String(ps.headingFont ?? "Playfair Display");
  const bodyFont = String(ps.bodyFont ?? "Inter");
  box.style.background = String(bs.background ?? "");
  box.style.borderRadius = `${toNum(bs.borderRadius, 12)}px`;
  box.style.padding = `${toNum(bs.padding, 16)}px`;
  if (title) {
    const h = document.createElement("h3");
    h.className = "section-title";
    h.style.fontSize = "1.2rem";
    h.style.fontFamily = headingFont;
    h.textContent = title;
    box.appendChild(h);
  }
  if (text) {
    const p = document.createElement("p");
    p.style.fontFamily = bodyFont;
    p.textContent = text;
    box.appendChild(p);
  }
  return box;
}

function renderImage(content, blockStyles) {
  const wrap = document.createElement("div");
  const bs = blockStyles && typeof blockStyles === "object" ? blockStyles : {};
  wrap.style.padding = `${toNum(bs.padding, 0)}px`;
  wrap.style.textAlign = String(bs.align ?? "left");
  const src = safeImgSrc(content?.src);
  if (!src) return wrap;
  const img = document.createElement("img");
  img.src = src;
  img.alt = String(content?.alt ?? "");
  img.style.width = String(content?.width ?? "100%");
  img.style.maxWidth = "100%";
  img.style.borderRadius = `${toNum(bs.borderRadius, 10)}px`;
  wrap.appendChild(img);
  return wrap;
}

function renderSpacer(content) {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.height = `${toNum(content?.height, 32)}px`;
  return el;
}

function renderBlocks(rows, pageStyles) {
  const mount = document.getElementById("site-builder-mount");
  if (!mount) return;
  mount.innerHTML = "";
  if (!rows?.length) return;
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const content = row.content && typeof row.content === "object" ? row.content : {};
    const styles = row.styles && typeof row.styles === "object" ? row.styles : {};
    if (row.type === "button") frag.appendChild(renderButton(content, styles));
    else if (row.type === "text") frag.appendChild(renderText(content, styles, pageStyles));
    else if (row.type === "section") frag.appendChild(renderSection(content, styles, pageStyles));
    else if (row.type === "image") frag.appendChild(renderImage(content, styles));
    else if (row.type === "spacer") frag.appendChild(renderSpacer(content));
  }
  mount.appendChild(frag);
}

async function main() {
  const mount = document.getElementById("site-builder-mount");
  if (!mount) return;
  const c = cfg();
  if (!c.url || !c.key) return;
  const supabase = getSb(c.url, c.key);
  const slug = pageSlug();

  // Защитный try/catch: если у site_pages нет колонок styles/status (старая схема),
  // выкидывать 400 в консоль не нужно — просто молча пропускаем рендер блоков.
  let page = null;
  try {
    const pub = await supabase
      .from("site_pages")
      .select("id,styles,status")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    page = pub.data;
    if (!page?.id) {
      const leg = await supabase
        .from("site_pages")
        .select("id,styles")
        .eq("slug", slug)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      page = leg.data;
    }
  } catch (_) {
    return;
  }
  if (!page?.id) return;

  applyPageStyles(mount, page);
  const { data: blocks } = await supabase
    .from("site_blocks")
    .select("id,type,content,styles,position")
    .eq("page_id", page.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  renderBlocks(blocks || [], page.styles);
}

void main();
