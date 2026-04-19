import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/** См. site-builder.mjs — общий singleton, чтобы не плодить GoTrueClient. */
function getSb(url, key) {
  const slot = "__alessannaPublicSb";
  const cached = globalThis[slot];
  if (cached && cached.__url === url && cached.__key === key) return cached.client;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  globalThis[slot] = { client, __url: url, __key: key };
  return client;
}

const READY_EVENT = "site-team-ready";

function cfg() {
  const sc = globalThis.SUPABASE_CONFIG;
  const url = String(sc?.url || globalThis.SALON_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(sc?.anonKey || globalThis.SALON_SUPABASE_ANON_KEY || "").trim();
  return { url, key };
}

function notifyReady() {
  globalThis.__SITE_TEAM_READY__ = true;
  window.dispatchEvent(new CustomEvent(READY_EVENT));
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Совпадает с site-services.mjs: публично видим только активных, не-админов
 * и тех, у кого show_on_marketing_site не выключен в CRM. Иначе админы-«технари»
 * могут протекать в публичный dropdown «Мастер», даже если триггер
 * staff_hide_admin_from_site по какой-то причине не сработал. */
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

function categoryNameRaw(r) {
  if (r?.service_listings?.service_categories?.name) return String(r.service_listings.service_categories.name);
  if (r?.service_listings?.category?.name) return String(r.service_listings.category.name);
  return "";
}

function slugKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

function buildGroups(links, staffMap) {
  const groups = new Map();
  for (const row of links) {
    if (row.show_on_site === false) continue;
    const sid = row.staff_id;
    const st = staffMap.get(sid);
    if (!st) continue;
    const cat = categoryNameRaw(row).trim() || "Muu";
    if (!groups.has(cat)) groups.set(cat, new Map());
    groups.get(cat).set(st.id, { id: st.id, name: st.name });
  }
  const out = [];
  for (const [cat, namesMap] of groups.entries()) {
    out.push({
      key: slugKey(cat),
      title: cat,
      nameKey: String(cat).trim().toLocaleLowerCase("ru"),
      names: Array.from(namesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * Принудительно «показать» секцию #meistrid.
 *
 * Зачем: разметка #meistrid использует `.reveal` (opacity:0 → .is-visible через
 * IntersectionObserver в script.js). Когда страница грузится с пустым
 * placeholder-ом «Состав команды подгружается из CRM…», `.team-block` низкий
 * (~40px) и при определённых rootMargin/threshold (-8% bottom + 0.08) observer
 * может не сработать. После того как site-team.mjs уже принёс 7 категорий
 * мастеров — секция в DOM есть, но всё ещё opacity:0, и визуально вместо неё
 * пустой провал 250–300px между «Изменения цен…» и «О салоне».
 *
 * Решение: после того как мы реально нарисовали мастеров, форсим
 * `.is-visible` на всех `.reveal` внутри #meistrid — данные пришли,
 * нет смысла ждать observer, тем более что он мог уже пропустить элемент.
 */
function forceRevealMeistrid() {
  const root = document.getElementById("meistrid");
  if (!root) return;
  root.querySelectorAll(".reveal").forEach((el) => {
    el.classList.add("is-visible");
  });
}

function renderTeam(groups, staffList) {
  const root = document.querySelector("#meistrid .team-groups");
  if (!root) return;

  if (!staffList.length) {
    root.innerHTML =
      '<div class="team-group"><h3 class="team-group-title">Meistrid</h3><ul class="team-names">' +
      "<li>—</li>" +
      "</ul></div>";
    forceRevealMeistrid();
    return;
  }

  if (!groups.length) {
    root.innerHTML =
      '<div class="team-group"><h3 class="team-group-title">Meistrid</h3><ul class="team-names">' +
      staffList
        .map((s) => '<li data-master-id="' + esc(String(s.id)) + '">' + esc(String(s.name || "")) + "</li>")
        .join("") +
      "</ul></div>";
    forceRevealMeistrid();
    window.dispatchEvent(new CustomEvent("site-team-rendered"));
    return;
  }

  root.innerHTML = groups
    .map((g) => {
      return (
        '<div class="team-group" data-category-key="' +
        esc(g.key || "") +
        '" data-category-name="' +
        esc(g.nameKey || "") +
        '">' +
        '<h3 class="team-group-title">' +
        esc(g.title) +
        "</h3>" +
        '<ul class="team-names">' +
        g.names.map((n) => '<li data-master-id="' + esc(n.id) + '">' + esc(n.name) + "</li>").join("") +
        "</ul>" +
        "</div>"
      );
    })
    .join("");

  forceRevealMeistrid();
  window.dispatchEvent(new CustomEvent("site-team-rendered"));
}

async function main() {
  const LOG = "[site-team]";
  try {
    globalThis.__SALON_PUBLIC_STAFF__ = [];
    const c = cfg();
    console.info(LOG, "Resolved config", { hasUrl: Boolean(c.url), hasKey: Boolean(c.key) });
    if (!c.url || !c.key) {
      console.warn(LOG, "Missing SUPABASE_CONFIG — render empty team");
      renderTeam([], []);
      return;
    }
    const supabase = getSb(c.url, c.key);

    const staffRes = await supabase
      .from("staff")
      .select("id,name,is_active,show_on_marketing_site,role,roles")
      .eq("is_active", true)
      .order("name");
    if (staffRes.error) {
      console.error(LOG, "staff query failed", staffRes.error);
      renderTeam([], []);
      return;
    }
    const staff = (staffRes.data || [])
      .filter(staffRowIsPublicVisible)
      .map((r) => ({ id: r.id, name: String(r.name || "").trim() }))
      .filter((r) => r.name);
    console.info(LOG, "Loaded staff", { total: staffRes.data?.length || 0, visible: staff.length });
    if (!staff.length) {
      renderTeam([], []);
      return;
    }

    const staffMap = new Map(staff.map((s) => [s.id, s]));
    const staffIds = staff.map((s) => s.id);

    const linksRes = await supabase
      .from("staff_services")
      .select("staff_id, show_on_site, service_listings!inner(id, service_categories(name))")
      .in("staff_id", staffIds);
    if (linksRes.error) {
      console.warn(LOG, "staff_services join failed — fallback to flat list", linksRes.error);
      globalThis.__SALON_PUBLIC_STAFF__ = staff.map((s) => ({ id: String(s.id), name: s.name }));
      renderTeam([], staff);
      return;
    }

    const groups = buildGroups(linksRes.data || [], staffMap);
    console.info(LOG, "Built team groups", { count: groups.length });
    globalThis.__SALON_PUBLIC_STAFF__ = staff.map((s) => ({ id: String(s.id), name: s.name }));
    renderTeam(groups, staff);
  } catch (e) {
    console.error(LOG, "main() threw", e);
  } finally {
    notifyReady();
  }
}

void main();

