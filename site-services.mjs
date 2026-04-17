/**
 * Marketing site services loader.
 * Pipeline: config -> Supabase -> public API fallback -> render.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const POLL_FALLBACK_MS = 60000;
const LOG_PREFIX = "[site-services]";

function info(msg, extra) {
  if (extra !== undefined) console.info(LOG_PREFIX, msg, extra);
  else console.info(LOG_PREFIX, msg);
}
function warnLog(msg, extra) {
  if (extra !== undefined) console.warn(LOG_PREFIX, msg, extra);
  else console.warn(LOG_PREFIX, msg);
}
function errorLog(msg, extra) {
  if (extra !== undefined) console.error(LOG_PREFIX, msg, extra);
  else console.error(LOG_PREFIX, msg);
}

function mountEl() {
  return document.getElementById("teenused-supabase-mount");
}

function setLoading() {
  const mount = mountEl();
  if (!mount) return;
  mount.innerHTML = '<p class="menu-footnote">Teenused laadivad...</p>';
}

function isPlaceholder(v) {
  const s = String(v || "").trim().toLowerCase();
  return !s || s.includes("your_anon_key") || s.includes("placeholder") || s === "your_key";
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
    /* non-bundled module: import.meta.env may be absent */
  }
  if (!url) url = String(globalThis.SALON_SUPABASE_URL || globalThis.VITE_SUPABASE_URL || "").trim();
  if (!key) key = String(globalThis.SALON_SUPABASE_ANON_KEY || globalThis.VITE_SUPABASE_ANON_KEY || "").trim();
  url = url.replace(/\/+$/, "");
  if (isPlaceholder(key)) key = "";
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
  const mount = mountEl();
  const warn = document.getElementById("teenused-config-warn");
  const form = document.getElementById("booking-form");
  const serviceSelect = form ? form.querySelector('select[name="service"]') : null;

  if (!mount) return;

  if (!groups || groups.length === 0) {
    mount.innerHTML =
      '<p class="menu-footnote">Teenuseid ei leitud. Kontrolli, et teenused oleksid andmebaasis aktiivsed.</p>';
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

function showConfigWarn(msg) {
  const warn = document.getElementById("teenused-config-warn");
  if (!warn) return;
  warn.hidden = false;
  warn.textContent = msg;
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

function mapPublicApiRows(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map(function (r) {
    const name = r.name_et != null ? String(r.name_et) : String(r.name || r.slug || "Teenus");
    const cents = Number(r.price_cents);
    return {
      id: String(r.id),
      name,
      price: Number.isFinite(cents) ? cents / 100 : null,
      duration: r.duration_min != null ? Number(r.duration_min) : null,
      category: null,
    };
  });
}

async function fetchPublicApiFallback() {
  const response = await fetch("/api/public/services", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("Public services API failed with HTTP " + response.status);
  }
  const json = await response.json();
  return mapPublicApiRows(json);
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
    return { data: rows, error: null, source: "service_listings" };
  }

  const listingsMinimal = await client
    .from("service_listings")
    .select("id,name,price,duration,is_active")
    .order("name", { ascending: true });

  if (!listingsMinimal.error) {
    const rows = (listingsMinimal.data || []).filter(function (r) {
      return r.is_active !== false;
    });
    return { data: rows, error: null, source: "service_listings_minimal" };
  }

  const legacy = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category,categories(name)")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (!legacy.error) {
    return { data: mapLegacyServiceRows(legacy.data), error: null, source: "legacy_services" };
  }

  const legacyNoJoin = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (!legacyNoJoin.error) {
    return { data: mapLegacyServiceRows(legacyNoJoin.data), error: null, source: "legacy_services_minimal" };
  }

  return {
    data: null,
    error: legacyNoJoin.error || legacy.error || listingsMinimal.error || listings.error,
    source: "none",
  };
}

async function run(client) {
  const result = await fetchPriceList(client);
  if (!result.error) {
    info("Loaded services from " + result.source + " (" + (result.data || []).length + ")");
    render(groupRows(result.data || []));
    return true;
  }

  warnLog("Supabase fetch failed, trying /api/public/services fallback", result.error);
  try {
    const fallbackData = await fetchPublicApiFallback();
    info("Loaded services from public API fallback (" + fallbackData.length + ")");
    render(groupRows(fallbackData));
    return true;
  } catch (fallbackError) {
    errorLog("Both Supabase and fallback API failed", {
      supabaseError: result.error,
      fallbackError,
    });
    showConfigWarn(
      "Teenuste laadimine ebaõnnestus. Kontrolli SUPABASE_CONFIG (url/anonKey), RLS õiguseid ja tabeleid service_listings/services. Vaata konsooli täpse veateate jaoks."
    );
    window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
    return false;
  }
}

async function main() {
  setLoading();
  const c = cfg();
  info("Resolved config", {
    hasUrl: Boolean(c.url),
    hasAnonKey: Boolean(c.key),
    urlHost: c.url ? c.url.replace(/^https?:\/\//, "") : "",
  });

  if (!c.url || !c.key) {
    warnLog("Supabase config missing, trying /api/public/services fallback", c);
    try {
      const fallbackData = await fetchPublicApiFallback();
      info("Loaded services from public API fallback (" + fallbackData.length + ")");
      render(groupRows(fallbackData));
      return;
    } catch (fallbackError) {
      errorLog("Missing config and fallback failed", fallbackError);
      showConfigWarn(
        "Uuenda supabase-public-config.js: määra korrektne URL ja anonKey. Või kontrolli, et /api/public/services oleks saadaval. Vaata konsooli."
      );
      window.dispatchEvent(new CustomEvent("teenused-supabase-ready"));
      return;
    }
  }

  const client = createClient(c.url, c.key);
  const refresh = () => void run(client);

  await run(client);

  client
    .channel("site-service-catalog")
    .on("postgres_changes", { event: "*", schema: "public", table: "service_listings" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "service_categories" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "services" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, refresh)
    .subscribe(function (status) {
      info("Realtime channel status: " + status);
    });

  setInterval(refresh, POLL_FALLBACK_MS);

  window.addEventListener("storage", function (ev) {
    if (ev.key === "salon-services-bump") refresh();
  });
}

void main();
