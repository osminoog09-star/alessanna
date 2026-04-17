import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

/** CRM flag: hidden from marketing / public booking when false (shadow-test by turning on). */
function staffRowIsPublicVisible(r) {
  return r.show_on_marketing_site !== false;
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

function renderTeam(groups, staffList) {
  const root = document.querySelector("#meistrid .team-groups");
  if (!root) return;

  if (!staffList.length) {
    root.innerHTML =
      '<div class="team-group"><h3 class="team-group-title">Meistrid</h3><ul class="team-names">' +
      "<li>—</li>" +
      "</ul></div>";
    return;
  }

  if (!groups.length) {
    root.innerHTML =
      '<div class="team-group"><h3 class="team-group-title">Meistrid</h3><ul class="team-names">' +
      staffList
        .map((s) => '<li data-master-id="' + esc(String(s.id)) + '">' + esc(String(s.name || "")) + "</li>")
        .join("") +
      "</ul></div>";
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

  window.dispatchEvent(new CustomEvent("site-team-rendered"));
}

async function main() {
  try {
    globalThis.__SALON_PUBLIC_STAFF__ = [];
    const c = cfg();
    if (!c.url || !c.key) {
      renderTeam([], []);
      return;
    }
    const supabase = createClient(c.url, c.key);

    const { data: staffRows } = await supabase
      .from("staff")
      .select("id,name,is_active,show_on_marketing_site")
      .eq("is_active", true)
      .order("name");
    const staff = (staffRows || [])
      .filter(staffRowIsPublicVisible)
      .map((r) => ({ id: r.id, name: String(r.name || "").trim() }))
      .filter((r) => r.name);
    if (!staff.length) {
      renderTeam([], []);
      return;
    }

    const staffMap = new Map(staff.map((s) => [s.id, s]));
    const staffIds = staff.map((s) => s.id);

    const { data: linksRows } = await supabase
      .from("staff_services")
      .select("staff_id, show_on_site, service_listings!inner(id, service_categories(name))")
      .in("staff_id", staffIds);

    const groups = buildGroups(linksRows || [], staffMap);
    globalThis.__SALON_PUBLIC_STAFF__ = staff.map((s) => ({ id: String(s.id), name: s.name }));
    renderTeam(groups, staff);
  } finally {
    notifyReady();
  }
}

void main();

