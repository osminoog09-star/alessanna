/**
 * Marketing site: price list from Supabase (service_listings, fallback legacy `services`) + categories.
 * Config: supabase-public-config.js sets window.SUPABASE_CONFIG { url, anonKey }.
 * Fallback: import.meta.env (Vite), then SALON_* / VITE_* globals.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const POLL_FALLBACK_MS = 60000;

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
    /* non-bundled module: import.meta.env may be absent */
  }
  if (!url) url = String(globalThis.SALON_SUPABASE_URL || globalThis.VITE_SUPABASE_URL || "").trim();
  if (!key) key = String(globalThis.SALON_SUPABASE_ANON_KEY || globalThis.VITE_SUPABASE_ANON_KEY || "").trim();
  url = url.replace(/\/+$/, "");
  return { url, key };
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

/** Normalize legacy `public.services` (+ optional categories join) to service_listings shape. */
function mapLegacyServiceRows(raw) {
  const rows = raw || [];
  return rows.map(function (r) {
    const cat =
      r.categories && r.categories.name != null
        ? { name: String(r.categories.name).trim() }
        : r.category && String(r.category).trim()
          ? { name: String(r.category).trim() }
          : null;
    const priceCents = Number(r.price_cents);
    const price = Number.isFinite(priceCents) ? priceCents / 100 : null;
    return {
      id: String(r.id),
      name: r.name_et != null ? String(r.name_et) : String(r.name || ""),
      price,
      duration: r.duration_min != null ? r.duration_min : r.duration,
      category: cat && cat.name ? cat : null,
    };
  });
}

async function fetchPriceList(client) {
  const listings = await client
    .from("service_listings")
    .select(
      `
      id,
      name,
      price,
      duration,
      is_active,
      category:service_categories(name)
    `
    )
    .order("name", { ascending: true });

  if (!listings.error) {
    const rows = (listings.data || []).filter(function (r) {
      return r.is_active !== false;
    });
    return { data: rows, error: null };
  }

  const listingsMinimal = await client
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
    .order("name", { ascending: true });

  if (!listingsMinimal.error) {
    return { data: listingsMinimal.data || [], error: null };
  }

  const legacy = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category,categories(name)")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (!legacy.error) {
    return { data: mapLegacyServiceRows(legacy.data), error: null };
  }

  const legacyNoJoin = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (!legacyNoJoin.error) {
    return { data: mapLegacyServiceRows(legacyNoJoin.data), error: null };
  }

  return { data: null, error: listingsMinimal.error || listings.error };
}

async function run(client) {
  const warn = document.getElementById("teenused-config-warn");
  const { data, error } = await fetchPriceList(client);

  if (error) {
    if (warn) {
      warn.hidden = false;
      warn.textContent =
        "Teenuste laadimine ebaõnnestus. Kontrolli Supabase URL / anon võti (SUPABASE_CONFIG), RLS ja tabelid service_listings või services (+ kategooriad).";
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
    .on("postgres_changes", { event: "*", schema: "public", table: "services" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, refresh)
    .subscribe();

  setInterval(refresh, POLL_FALLBACK_MS);

  window.addEventListener("storage", function (ev) {
    if (ev.key === "salon-services-bump") refresh();
  });

}

main();
