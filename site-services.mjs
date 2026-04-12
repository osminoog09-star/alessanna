/**
 * Marketing site: service_listings + category embed (Supabase JS + Realtime).
 * Config: supabase-public-config.js sets SALON_SUPABASE_URL / SALON_SUPABASE_ANON_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const POLL_FALLBACK_MS = 60000;

function cfg() {
  const url = globalThis.SALON_SUPABASE_URL || globalThis.VITE_SUPABASE_URL;
  const key = globalThis.SALON_SUPABASE_ANON_KEY || globalThis.VITE_SUPABASE_ANON_KEY;
  return { url: url ? String(url).replace(/\/+$/, "") : "", key: key || "" };
}

function fmtPrice(p) {
  if (p == null || p === "") return "—";
  const n = Number(p);
  if (Number.isNaN(n)) return String(p);
  return n.toFixed(0).replace(".", ",") + " €";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function groupRows(rows) {
  const map = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = r.category;
    const hasName = cat && cat.name != null && String(cat.name).trim() !== "";
    const id = hasName ? "n:" + String(cat.name).trim() : "__none__";
    const name = hasName ? String(cat.name).trim() : "Muu";
    if (!map.has(id)) map.set(id, { id, name, items: [] });
    map.get(id).items.push(r);
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.items.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "et");
    });
  }
  return groups.sort(function (a, b) {
    if (a.id === "__none__") return 1;
    if (b.id === "__none__") return -1;
    return a.name.localeCompare(b.name, "et");
  });
}

function render(groups) {
  const mount = document.getElementById("teenused-supabase-mount");
  const warn = document.getElementById("teenused-config-warn");
  const form = document.getElementById("booking-form");
  const serviceSelect = form ? form.querySelector('select[name="service"]') : null;

  if (!mount) return;

  if (!groups || groups.length === 0) {
    mount.innerHTML =
      '<p class="menu-footnote">Teenuseid pole veel lisatud või need pole aktiivsed. Halda CRM-is.</p>';
    if (warn) warn.hidden = true;
    window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
    return;
  }

  if (serviceSelect) {
    serviceSelect.innerHTML = "";
    for (let g = 0; g < groups.length; g++) {
      const gr = groups[g];
      const opt = document.createElement("option");
      opt.value = gr.id === "__none__" ? "other" : gr.id;
      opt.textContent = gr.name;
      serviceSelect.appendChild(opt);
    }
  }

  let tabHtml = '<div class="tabs-bar reveal" role="tablist" aria-label="Teenuste kategooriad">';
  let panelHtml = "";
  for (let t = 0; t < groups.length; t++) {
    const gr = groups[t];
    const panelId = "panel-cat-" + String(gr.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    const tabId = "tab-cat-" + t;
    const isFirst = t === 0;
    const catKey = gr.id === "__none__" ? "other" : gr.id;
    tabHtml +=
      '<button type="button" class="tab-btn' +
      (isFirst ? " is-active" : "") +
      '" role="tab" aria-selected="' +
      (isFirst ? "true" : "false") +
      '" aria-controls="' +
      esc(panelId) +
      '" id="' +
      esc(tabId) +
      '" data-tab-index="' +
      t +
      '">' +
      esc(gr.name) +
      "</button>";

    panelHtml +=
      '<div id="' +
      esc(panelId) +
      '" class="tab-panel reveal' +
      (isFirst ? " is-active" : "") +
      '" role="tabpanel" aria-labelledby="' +
      esc(tabId) +
      '"' +
      (isFirst ? "" : " hidden") +
      ' data-pick-category="' +
      esc(catKey) +
      '"><ul class="menu-list">';
    for (let j = 0; j < gr.items.length; j++) {
      const it = gr.items[j];
      const dur = it.duration != null ? it.duration + " min" : "";
      panelHtml +=
        "<li><span>" +
        esc(it.name) +
        '</span><span class="price">' +
        esc(fmtPrice(it.price)) +
        (dur ? " · " + esc(dur) : "") +
        "</span></li>";
    }
    panelHtml += "</ul></div>";
  }
  tabHtml += "</div>";
  mount.innerHTML = tabHtml + panelHtml;

  if (warn) warn.hidden = true;
  window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
}

async function run(client) {
  const warn = document.getElementById("teenused-config-warn");
  const { data, error } = await client
    .from("service_listings")
    .select(
      `
      id,
      name,
      price,
      duration,
      category:service_categories(name)
    `
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    if (warn) {
      warn.hidden = false;
      warn.textContent =
        "Teenuste laadimine ebaõnnestus. Kontrolli Supabase URL / anon võti, RLS ja Realtime (service_listings, service_categories).";
    }
    window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
    return;
  }
  render(groupRows(data || []));
}

function main() {
  const c = cfg();
  const warn = document.getElementById("teenused-config-warn");
  if (!c.url || !c.key) {
    if (warn) warn.hidden = false;
    window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
    return;
  }

  const client = createClient(c.url, c.key);
  const refresh = () => void run(client);

  void run(client);

  const ch = client
    .channel("site-service-catalog")
    .on("postgres_changes", { event: "*", schema: "public", table: "service_listings" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "service_categories" }, refresh)
    .subscribe();

  setInterval(refresh, POLL_FALLBACK_MS);

  window.addEventListener("storage", function (ev) {
    if (ev.key === "salon-services-bump") refresh();
  });

}

main();
