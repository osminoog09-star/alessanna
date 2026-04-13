import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pageSlug() {
  const q = new URLSearchParams(window.location.search).get("page");
  if (q && q.trim()) return q.trim();
  const p = window.location.pathname.toLowerCase();
  if (p.endsWith("/ru.html")) return "home-ru";
  return "home";
}

function renderButton(content) {
  const label = String(content?.label ?? "Button");
  const action = String(content?.action ?? "scroll");
  const target = String(content?.target ?? "");
  const wrap = document.createElement("div");
  wrap.className = "site-builder-item";
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

function renderText(content) {
  const txt = String(content?.text ?? "");
  const p = document.createElement("p");
  p.className = "section-lead";
  p.textContent = txt;
  return p;
}

function renderSection(content) {
  const title = String(content?.title ?? "");
  const text = String(content?.text ?? "");
  const box = document.createElement("div");
  box.className = "gift-card";
  if (title) {
    const h = document.createElement("h3");
    h.className = "section-title";
    h.style.fontSize = "1.2rem";
    h.textContent = title;
    box.appendChild(h);
  }
  if (text) {
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
  }
  return box;
}

function renderBlocks(rows) {
  const mount = document.getElementById("site-builder-mount");
  if (!mount) return;
  mount.innerHTML = "";
  if (!rows?.length) return;
  const frag = document.createDocumentFragment();
  for (const row of rows) {
    const content = row.content && typeof row.content === "object" ? row.content : {};
    if (row.type === "button") frag.appendChild(renderButton(content));
    else if (row.type === "text") frag.appendChild(renderText(content));
    else if (row.type === "section") frag.appendChild(renderSection(content));
  }
  mount.appendChild(frag);
}

async function main() {
  const mount = document.getElementById("site-builder-mount");
  if (!mount) return;
  const c = cfg();
  if (!c.url || !c.key) return;
  const supabase = createClient(c.url, c.key);
  const slug = pageSlug();

  const { data: page } = await supabase.from("site_pages").select("id").eq("slug", slug).maybeSingle();
  if (!page?.id) return;

  const { data: blocks } = await supabase
    .from("site_blocks")
    .select("id,type,content,position")
    .eq("page_id", page.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  renderBlocks(blocks || []);
}

void main();

