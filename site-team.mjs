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

function categoryNameRaw(r) {
  if (r?.service_listings?.service_categories?.name) return String(r.service_listings.service_categories.name);
  if (r?.service_listings?.category?.name) return String(r.service_listings.category.name);
  return "";
}

function buildGroups(links, staffMap) {
  const groups = new Map();
  for (const row of links) {
    const sid = row.staff_id;
    const st = staffMap.get(sid);
    if (!st) continue;
    const cat = categoryNameRaw(row).trim() || "Muu";
    if (!groups.has(cat)) groups.set(cat, new Map());
    groups.get(cat).set(st.id, st.name);
  }
  const out = [];
  for (const [cat, namesMap] of groups.entries()) {
    out.push({
      title: cat,
      names: Array.from(namesMap.values()).sort((a, b) => a.localeCompare(b)),
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function renderTeam(groups, allNames) {
  const root = document.querySelector("#meistrid .team-groups");
  if (!root) return;

  if (!groups.length) {
    root.innerHTML =
      '<div class="team-group"><h3 class="team-group-title">Meistrid</h3><ul class="team-names">' +
      allNames.map((n) => "<li>" + esc(n) + "</li>").join("") +
      "</ul></div>";
    return;
  }

  root.innerHTML = groups
    .map((g) => {
      return (
        '<div class="team-group">' +
        '<h3 class="team-group-title">' +
        esc(g.title) +
        "</h3>" +
        '<ul class="team-names">' +
        g.names.map((n) => "<li>" + esc(n) + "</li>").join("") +
        "</ul>" +
        "</div>"
      );
    })
    .join("");
}

async function main() {
  try {
    const c = cfg();
    if (!c.url || !c.key) return;
    const supabase = createClient(c.url, c.key);

    const { data: staffRows } = await supabase.from("staff").select("id,name,is_active").eq("is_active", true).order("name");
    const staff = (staffRows || []).map((r) => ({ id: r.id, name: String(r.name || "").trim() })).filter((r) => r.name);
    if (!staff.length) return;

    const staffMap = new Map(staff.map((s) => [s.id, s]));
    const staffIds = staff.map((s) => s.id);

    const { data: linksRows } = await supabase
      .from("staff_services")
      .select("staff_id, service_listings!inner(id, service_categories(name))")
      .in("staff_id", staffIds);

    const groups = buildGroups(linksRows || [], staffMap);
    renderTeam(groups, staff.map((s) => s.name));
  } finally {
    notifyReady();
  }
}

void main();

