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

function keyPreview(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw.length <= 10) return raw;
  return raw.slice(0, 6) + "..." + raw.slice(-4);
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

/**
 * Публичный сайт: только услуги с привязкой к категории (как в CRM после выбора категории).
 * Черновики без category / category_id не показываем — они остаются только в рабочем CRM.
 */
function groupRows(rows) {
  const map = new Map();
  let dropped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cat = r.category;
    const hasName = cat && cat.name != null && String(cat.name).trim() !== "";
    if (!hasName) {
      dropped++;
      continue;
    }
    const id = "n:" + String(cat.name).trim();
    const name = String(cat.name).trim();
    if (!map.has(id)) map.set(id, { id, name, items: [] });
    map.get(id).items.push(r);
  }
  if (dropped > 0) {
    info("Omitted services without category from public catalog", { count: dropped });
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.items.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "et");
    });
  }
  return groups.sort(function (a, b) {
    return a.name.localeCompare(b.name, "et");
  });
}

function groupsFromCategoryNames(names) {
  const uniq = Array.from(
    new Set(
      (names || [])
        .map(function (n) {
          return String(n || "").trim();
        })
        .filter(Boolean)
    )
  );
  uniq.sort(function (a, b) {
    return a.localeCompare(b, "et");
  });
  return uniq.map(function (name) {
    return { id: "n:" + name, name, items: [] };
  });
}

/**
 * Публично показываем мастера, если он is_active, не скрыт от сайта и не admin/owner.
 * Совпадает с логикой site-team.mjs — иначе в корзине всплывают сотрудники, которых
 * на странице «Мастера» нет.
 */
function staffRowIsPublicVisible(r) {
  if (!r) return false;
  if (r.is_active === false) return false;
  if (r.show_on_marketing_site === false) return false;
  const role = String(r.role || "").toLowerCase();
  if (role === "admin" || role === "owner") return false;
  const roles = Array.isArray(r.roles) ? r.roles : [];
  for (let i = 0; i < roles.length; i++) {
    const rr = String(roles[i] || "").toLowerCase();
    if (rr === "admin" || rr === "owner") return false;
  }
  return true;
}

/**
 * Грузит `staff_services` и строит карту service_id -> [visible_master_id...].
 * Ошибки тихо глотаем: при сбое карта останется пустой — корзина упадёт в старое
 * поведение (категория из блока «Мастера»).
 */
async function fetchServiceMasters(client) {
  const out = new Map();
  try {
    const staff = await client
      .from("staff")
      .select("id,is_active,show_on_marketing_site,role,roles")
      .eq("is_active", true);
    if (staff.error) {
      warnLog("staff lookup failed for service-masters map", staff.error);
      return out;
    }
    const visibleIds = new Set(
      (staff.data || [])
        .filter(staffRowIsPublicVisible)
        .map((r) => String(r.id))
    );
    if (!visibleIds.size) return out;

    const links = await client
      .from("staff_services")
      .select("service_id, staff_id, show_on_site");
    if (links.error) {
      warnLog("staff_services lookup failed for service-masters map", links.error);
      return out;
    }
    for (const row of links.data || []) {
      if (row.show_on_site === false) continue;
      const sid = String(row.staff_id ?? "");
      const svc = String(row.service_id ?? "");
      if (!sid || !svc) continue;
      if (!visibleIds.has(sid)) continue;
      if (!out.has(svc)) out.set(svc, []);
      out.get(svc).push(sid);
    }
  } catch (e) {
    warnLog("fetchServiceMasters threw", e);
  }
  return out;
}

function render(groups, serviceMasters) {
  const mount = mountEl();
  const warn = document.getElementById("teenused-config-warn");
  const form = document.getElementById("booking-form");
  const serviceSelect = form ? form.querySelector('select[name="service"]') : null;
  const svcMasters = serviceMasters instanceof Map ? serviceMasters : new Map();

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
      opt.value = gr.id;
      opt.textContent = gr.name;
      serviceSelect.appendChild(opt);
    }
  }

  let tabHtml = '<div class="tabs-bar" role="tablist" aria-label="Teenuste kategooriad">';
  let panelHtml = "";
  for (let t = 0; t < groups.length; t++) {
    const gr = groups[t];
    /* Уникальный id по индексу: slug от кириллицы даёт одинаковую длину дефисов у разных «n:…» → дубли id и все панели видны сразу. */
    const panelId = "panel-cat-" + t;
    const tabId = "tab-cat-" + t;
    const isFirst = t === 0;
    const catKey = gr.id;
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
      '" class="tab-panel' +
      (isFirst ? " is-active" : "") +
      '" role="tabpanel" aria-labelledby="' +
      esc(tabId) +
      '"' +
      (isFirst ? "" : " hidden") +
      ' data-pick-category="' +
      esc(catKey) +
      '"><ul class="menu-list">';
    if (!gr.items || gr.items.length === 0) {
      panelHtml += '<li><span class="menu-footnote">Teenused lisatakse peagi.</span></li>';
    } else {
      for (let j = 0; j < gr.items.length; j++) {
        const it = gr.items[j];
        /* Длительность не показываем на сайте: она для CRM и слотов календаря. */
        const svcId = String(it.id || "");
        const masters = svcMasters.get(svcId) || [];
        /* data-service-masters — список мастеров, закреплённых за ЭТОЙ услугой
         * (пустая строка = «все активные мастера»). script.js использует эти id,
         * чтобы в корзине показать только тех, кто реально делает услугу. */
        panelHtml +=
          '<li data-service-id="' +
          esc(svcId) +
          '" data-service-masters="' +
          esc(masters.join(",")) +
          '"><span>' +
          esc(it.name) +
          '</span><span class="price">' +
          esc(fmtPrice(it.price)) +
          "</span></li>";
      }
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

function showCatalogWarn(msg) {
  showConfigWarn(msg);
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
    const directPrice = Number(r.price);
    const price = Number.isFinite(priceCents) ? priceCents / 100 : Number.isFinite(directPrice) ? directPrice : null;
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
  const configuredApiBase = String(globalThis.SALON_PUBLIC_API_BASE || "").trim().replace(/\/+$/, "");
  const endpoints = ["/api/public/services"];
  if (configuredApiBase) endpoints.push(configuredApiBase + "/api/public/services");
  endpoints.push("https://work.alessannailu.com/api/public/services");
  let lastError = null;
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " at " + endpoint);
      }
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("application/json")) {
        throw new Error("Unexpected content-type (" + contentType + ") at " + endpoint);
      }
      const json = await response.json();
      if (!Array.isArray(json)) {
        throw new Error("Unexpected JSON shape at " + endpoint + " (expected array)");
      }
      info("Public API fallback succeeded via " + endpoint);
      return mapPublicApiRows(json);
    } catch (err) {
      lastError = err;
      warnLog("Public API fallback failed via " + endpoint, err);
    }
  }
  throw lastError || new Error("Public services API fallback failed");
}

async function fetchCategoryNames(client) {
  const modern = await client.from("service_categories").select("name").order("name", { ascending: true });
  if (!modern.error) {
    return (modern.data || [])
      .map(function (r) {
        return String(r.name || "").trim();
      })
      .filter(Boolean);
  }

  const legacy = await client.from("categories").select("name").order("name", { ascending: true });
  if (!legacy.error) {
    return (legacy.data || [])
      .map(function (r) {
        return String(r.name || "").trim();
      })
      .filter(Boolean);
  }

  return [];
}

async function fetchPriceList(client) {
  function hasRows(res) {
    return !res.error && Array.isArray(res.data) && res.data.length > 0;
  }

  /* Prefer query without is_active first: some production DBs predate the column and PostgREST returns 400 if it is selected. */
  const listingsPrimary = await client
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

  info("Supabase response: service_listings (primary)", {
    data: listingsPrimary.data,
    error: listingsPrimary.error,
  });

  if (hasRows(listingsPrimary)) {
    return { data: listingsPrimary.data || [], error: null, source: "service_listings" };
  }

  warnLog("service_listings primary query failed", listingsPrimary.error);

  const listingsWithActive = await client
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

  info("Supabase response: service_listings (with is_active)", {
    data: listingsWithActive.data,
    error: listingsWithActive.error,
  });

  if (hasRows(listingsWithActive)) {
    const rows = (listingsWithActive.data || []).filter(function (r) {
      return r.is_active !== false;
    });
    return { data: rows, error: null, source: "service_listings_filtered" };
  }

  warnLog("service_listings with-is_active query failed", listingsWithActive.error);

  const listingsMinimal = await client
    .from("service_listings")
    .select("id,name,price,duration")
    .order("name", { ascending: true });

  info("Supabase response: service_listings (minimal)", {
    data: listingsMinimal.data,
    error: listingsMinimal.error,
  });

  if (hasRows(listingsMinimal)) {
    return { data: listingsMinimal.data || [], error: null, source: "service_listings_minimal" };
  }

  warnLog("service_listings minimal query failed", listingsMinimal.error);

  // Primary fallback: modern public.services schema (name/price/duration/category)
  const servicesModern = await client
    .from("services")
    .select("id,name,price,duration,category,sort_order,created_at")
    .order("sort_order", { ascending: true });

  info("Supabase response: services (modern schema)", {
    data: servicesModern.data,
    error: servicesModern.error,
  });

  if (hasRows(servicesModern)) {
    return { data: mapLegacyServiceRows(servicesModern.data), error: null, source: "services_modern" };
  }

  warnLog("services modern schema query failed", servicesModern.error);

  const legacy = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category,categories(name)")
    .order("sort_order", { ascending: true });

  info("Supabase response: services (legacy with categories)", {
    data: legacy.data,
    error: legacy.error,
  });

  if (hasRows(legacy)) {
    const rows = (legacy.data || []).filter(function (r) {
      return r.active !== false && r.is_active !== false;
    });
    return { data: mapLegacyServiceRows(rows), error: null, source: "legacy_services" };
  }

  warnLog("legacy services query with categories failed", legacy.error);

  const legacyNoJoin = await client
    .from("services")
    .select("id,name_et,price_cents,duration_min,active,sort_order,category")
    .order("sort_order", { ascending: true });

  info("Supabase response: services (legacy no categories)", {
    data: legacyNoJoin.data,
    error: legacyNoJoin.error,
  });

  if (hasRows(legacyNoJoin)) {
    const rows = (legacyNoJoin.data || []).filter(function (r) {
      return r.active !== false && r.is_active !== false;
    });
    return { data: mapLegacyServiceRows(rows), error: null, source: "legacy_services_minimal" };
  }

  warnLog("legacy services query no-join failed", legacyNoJoin.error);

  const legacyAlt = await client
    .from("services")
    .select("id,name,price,duration,active,sort_order,category,categories(name)")
    .order("sort_order", { ascending: true });

  info("Supabase response: services (alt schema)", {
    data: legacyAlt.data,
    error: legacyAlt.error,
  });

  if (hasRows(legacyAlt)) {
    const rows = (legacyAlt.data || []).filter(function (r) {
      return r.active !== false && r.is_active !== false;
    });
    return { data: mapLegacyServiceRows(rows), error: null, source: "legacy_services_alt" };
  }

  warnLog("legacy services alt-schema query failed", legacyAlt.error);

  const legacyAltNoJoin = await client
    .from("services")
    .select("id,name,price,duration,active,sort_order,category")
    .order("sort_order", { ascending: true });

  info("Supabase response: services (alt schema no categories)", {
    data: legacyAltNoJoin.data,
    error: legacyAltNoJoin.error,
  });

  if (hasRows(legacyAltNoJoin)) {
    const rows = (legacyAltNoJoin.data || []).filter(function (r) {
      return r.active !== false && r.is_active !== false;
    });
    return { data: mapLegacyServiceRows(rows), error: null, source: "legacy_services_alt_minimal" };
  }

  return {
    data: null,
    error:
      legacyAltNoJoin.error ||
      legacyAlt.error ||
      legacyNoJoin.error ||
      legacy.error ||
      servicesModern.error ||
      listingsMinimal.error ||
      listingsWithActive.error ||
      listingsPrimary.error,
    source: "none",
  };
}

async function run(client) {
  const [result, svcMasters] = await Promise.all([fetchPriceList(client), fetchServiceMasters(client)]);
  if (!result.error) {
    const rows = result.data || [];
    info("Loaded services from " + result.source + " (" + rows.length + ")");
    info("Loaded service→masters map (" + svcMasters.size + " services with explicit staff)");
    if (rows.length > 0) {
      render(groupRows(rows), svcMasters);
      return true;
    }
    try {
      const names = await fetchCategoryNames(client);
      if (names.length > 0) {
        info("Loaded categories without services (" + names.length + ")");
        render(groupsFromCategoryNames(names), svcMasters);
        showCatalogWarn(
          "Kategooriad on olemas, kuid teenuseid ei leitud. Lisa vähemalt üks teenus CRM-is või kontrolli, et teenused sünkroniseeritakse tabelisse service_listings."
        );
        return true;
      }
    } catch (catErr) {
      warnLog("Failed to load categories for empty catalog fallback", catErr);
    }
    warnLog("Supabase returned zero services, trying /api/public/services fallback");
    try {
      const fallbackData = await fetchPublicApiFallback();
      if (fallbackData.length > 0) {
        info("Loaded services from public API fallback (" + fallbackData.length + ")");
        render(groupRows(fallbackData), svcMasters);
        return true;
      }
      info("Fallback returned zero services too; rendering empty state");
      render(groupRows(rows), svcMasters);
      showCatalogWarn(
        "Teenuste nimekiri on tühi nii Supabase'is kui ka varu API-s. Kontrolli, et teenused oleksid lisatud ja aktiivsed."
      );
      return true;
    } catch (fallbackEmptyError) {
      warnLog("Fallback failed after empty Supabase response; rendering empty state", fallbackEmptyError);
      render(groupRows(rows), svcMasters);
      showCatalogWarn(
        "Teenuseid ei saadud laadida: Supabase tagastas tühja kataloogi ja varu API ei vastanud korrektselt. Kontrolli RLS õiguseid ja SALON_PUBLIC_API_BASE väärtust."
      );
      return true;
    }
  }

  warnLog("Supabase fetch failed, trying /api/public/services fallback", result.error);
  try {
    const fallbackData = await fetchPublicApiFallback();
    info("Loaded services from public API fallback (" + fallbackData.length + ")");
    render(groupRows(fallbackData), svcMasters);
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
    anonKeyPreview: keyPreview(c.key),
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
    /* staff_services / staff меняют карту «услуга → мастера», которая рендерится
     * в data-service-masters на каждой строке .menu-list, и корзина сразу
     * подхватывает новые назначения без перезагрузки страницы. */
    .on("postgres_changes", { event: "*", schema: "public", table: "staff_services" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "staff" }, refresh)
    .subscribe(function (status) {
      info("Realtime channel status: " + status);
    });

  setInterval(refresh, POLL_FALLBACK_MS);

  window.addEventListener("storage", function (ev) {
    if (ev.key === "salon-services-bump") refresh();
  });
}

void main();
