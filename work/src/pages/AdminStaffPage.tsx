import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useEmployeesDirectoryRealtime, useStaffAssignmentsCatalogRealtime } from "../hooks/useSalonRealtime";
import { normalizeRoles, sanitizeRolesForSave } from "../lib/roles";
import type { StaffServiceRow, StaffTableRow } from "../types/database";
import type { Role } from "../types/database";

type UiRole = Role;
type CatalogSkillService = {
  id: string;
  name: string;
  is_active: boolean;
  /** Для группировки в блоке навыков мастера */
  category_name: string;
  /** true = id взят из `service_listings` (UUID), false = legacy `services` (bigint). */
  from_listings: boolean;
};

type StaffCatalogResult = {
  services: CatalogSkillService[];
  listingsEmpty: boolean;
};

async function loadStaffPageCatalog(): Promise<StaffCatalogResult> {
  const uncategorized = "Без категории";
  /* После миграции 012 `staff_services.service_id` → UUID `service_listings.id`.
   * Раньше сюда первым шёл legacy `services` (bigint id): переключатели не совпадали с БД и insert ломался по FK. */
  let sl = await supabase
    .from("service_listings")
    .select("id,name,is_active,category_id,service_categories(name)")
    .order("name", { ascending: true });
  if (sl.error) {
    sl = await supabase.from("service_listings").select("id,name,is_active,category_id").order("name", { ascending: true });
  }
  if (sl.error) {
    sl = await supabase.from("service_listings").select("id,name,is_active").order("name", { ascending: true });
  }
  if (sl.error) {
    sl = await supabase.from("service_listings").select("id,name").order("name", { ascending: true });
  }
  if (!sl.error && sl.data && sl.data.length > 0) {
    const services = (
      sl.data as Array<{
        id: string;
        name?: string;
        is_active?: boolean;
        service_categories?: { name?: string | null } | null;
      }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || "").trim(),
        is_active: s.is_active !== false,
        category_name: String(s.service_categories?.name || "").trim() || uncategorized,
        from_listings: true,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: false };
  }

  let sLegacy = await supabase
    .from("services")
    .select("id,name_et,active,category")
    .order("sort_order", { ascending: true });
  if (sLegacy.error) {
    sLegacy = await supabase.from("services").select("id,name_et,active").order("sort_order", { ascending: true });
  }
  if (!sLegacy.error && sLegacy.data && sLegacy.data.length > 0) {
    const services = (
      sLegacy.data as Array<{ id: unknown; name_et?: string; active?: boolean; category?: string | null }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name_et || "").trim(),
        is_active: s.active !== false,
        category_name: String(s.category || "").trim() || uncategorized,
        from_listings: false,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: true };
  }
  let sModern = await supabase
    .from("services")
    .select("id,name,active,is_active,category")
    .order("name", { ascending: true });
  if (sModern.error) {
    sModern = await supabase.from("services").select("id,name,active,is_active").order("name", { ascending: true });
  }
  if (sModern.data && sModern.data.length > 0) {
    const services = (
      sModern.data as Array<{
        id: unknown;
        name?: string;
        active?: boolean;
        is_active?: boolean;
        category?: string | null;
      }>
    )
      .map((s) => ({
        id: String(s.id),
        name: String(s.name || "").trim(),
        is_active: s.is_active !== false && s.active !== false,
        category_name: String(s.category || "").trim() || uncategorized,
        from_listings: false,
      }))
      .filter((x) => x.name);
    return { services, listingsEmpty: true };
  }
  return { services: [], listingsEmpty: true };
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function normServiceName(n: string): string {
  return String(n || "").trim().toLowerCase();
}

function normId(id: string | number | null | undefined): string {
  return String(id ?? "")
    .trim()
    .toLowerCase();
}

function isMissingStaffMarketingColumnError(err: { message?: string } | null | undefined): boolean {
  const m = String(err?.message || "").toLowerCase();
  return (
    m.includes("show_on_marketing_site") ||
    (m.includes("column") && (m.includes("does not exist") || m.includes("could not find"))) ||
    m.includes("schema cache")
  );
}

export function AdminStaffPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffTableRow[]>([]);
  const [services, setServices] = useState<CatalogSkillService[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [newRoles, setNewRoles] = useState<UiRole[]>(["worker"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  /** Компактный список: детали (роли, услуги) только в раскрытой строке. */
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  /** id строки в каталоге CRM → UUID service_listings (FK staff_services.service_id). */
  const [catalogIdToListingId, setCatalogIdToListingId] = useState<Record<string, string>>({});
  /** Раскрытые категории услуг в строке мастера: ключ `staffId::название категории`. */
  const [skillCategoryExpanded, setSkillCategoryExpanded] = useState<Record<string, boolean>>({});
  /** false = колонка есть; true = в БД нет staff.show_on_marketing_site (нужна миграция 020). */
  const [staffMarketingColumnMissing, setStaffMarketingColumnMissing] = useState(false);
  /** true = таблица service_listings пуста, каталог тянется из legacy `services` — FK staff_services ломается. */
  const [serviceListingsEmpty, setServiceListingsEmpty] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const [st, lk] = await Promise.all([
      supabase.from("staff").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_services").select("*"),
    ]);
    if (st.error) {
      setErr(st.error.message);
      setLoading(false);
      return;
    }
    const colProbe = await supabase.from("staff").select("id, show_on_marketing_site").limit(1);
    setStaffMarketingColumnMissing(!!colProbe.error && isMissingStaffMarketingColumnError(colProbe.error));

    setRows((st.data ?? []) as StaffTableRow[]);

    const catalogResult = await loadStaffPageCatalog();
    const catalog = catalogResult.services;
    setServiceListingsEmpty(catalogResult.listingsEmpty);
    const listMeta = await supabase.from("service_listings").select("id,name");
    const map: Record<string, string> = {};
    if (!listMeta.error && listMeta.data?.length) {
      const listingIdSet = new Set(
        (listMeta.data as Array<{ id: string }>).map((r) => normId(String(r.id))),
      );
      const byNormName = new Map<string, string>();
      for (const row of listMeta.data as Array<{ id: string; name: string | null }>) {
        const k = normServiceName(String(row.name || ""));
        if (k) byNormName.set(k, String(row.id));
      }
      for (const s of catalog) {
        const cid = String(s.id);
        const cidNorm = normId(cid);
        if (listingIdSet.has(cidNorm)) map[cid] = cidNorm;
        else {
          const lid = byNormName.get(normServiceName(s.name));
          if (lid) map[cid] = String(lid);
        }
      }
    }
    setCatalogIdToListingId(map);
    setServices(catalog);

    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEmployeesDirectoryRealtime(load);
  useStaffAssignmentsCatalogRealtime(load);

  const activeServices = useMemo(() => services.filter((s) => s.is_active), [services]);

  const activeServicesByCategory = useMemo(() => {
    const m = new Map<string, CatalogSkillService[]>();
    for (const s of activeServices) {
      const c = String(s.category_name || "").trim() || "Без категории";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(s);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([name, svcs]) => ({
        name,
        services: [...svcs].sort((x, y) => x.name.localeCompare(y.name, "ru")),
      }));
  }, [activeServices]);

  function pickPrimaryRole(roles: UiRole[]): UiRole {
    if (roles.includes("admin")) return "admin";
    if (roles.includes("manager")) return "manager";
    return "worker";
  }

  function rowRoles(row: StaffTableRow): UiRole[] {
    const normalized = normalizeRoles((row as StaffTableRow & { roles?: unknown }).roles ?? row.role);
    return normalized as UiRole[];
  }

  function roleLabelsSummary(r: StaffTableRow): string {
    const pr = String(r.role || "").toLowerCase();
    if (pr === "owner") return "Owner";
    const cur = rowRoles(r);
    const bits: string[] = [];
    if (cur.includes("admin")) bits.push(t("role.admin"));
    if (cur.includes("manager")) bits.push(t("role.manager"));
    if (cur.includes("worker")) bits.push(t("role.worker"));
    return bits.length ? bits.join(" · ") : "—";
  }

  function toggleRowExpanded(id: string) {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleRoleToken(current: UiRole[], roleToken: UiRole, on: boolean): UiRole[] {
    const next = on ? [...new Set([...current, roleToken])] : current.filter((r) => r !== roleToken);
    return (next.length ? next : ["worker"]) as UiRole[];
  }

  async function updateStaffRoles(id: string, currentDbRoles: UiRole[], nextUiRoles: UiRole[]) {
    const nextRoles = sanitizeRolesForSave(nextUiRoles, true, currentDbRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(nextRoles);
    setErr(null);
    const { error } = await supabase.from("staff").update({ role: primaryRole, roles: nextRoles }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  function startEdit(r: StaffTableRow) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditPhone(r.phone ?? "");
    setExpandedById((prev) => ({ ...prev, [r.id]: true }));
  }

  async function saveEdit() {
    if (!editingId) return;
    setErr(null);
    const { error } = await supabase
      .from("staff")
      .update({
        name: editName.trim(),
        phone: digitsOnly(editPhone) || null,
      })
      .eq("id", editingId);
    if (error) {
      setErr(error.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function updateStaffActive(id: string, is_active: boolean) {
    setErr(null);
    const { error } = await supabase.from("staff").update({ is_active }).eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function updateStaffMarketingVisibility(id: string, show: boolean) {
    if (staffMarketingColumnMissing) return;
    setErr(null);
    const { error } = await supabase.from("staff").update({ show_on_marketing_site: show }).eq("id", id);
    if (error && isMissingStaffMarketingColumnError(error)) {
      setStaffMarketingColumnMissing(true);
      setErr(
        "Нужна миграция БД: staff.show_on_marketing_site — выполните supabase/migrations/020_staff_show_on_marketing_site.sql в Supabase, затем обновите страницу.",
      );
      return;
    }
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const cleanPhone = digitsOnly(phone);
    const n = name.trim();
    if (!cleanPhone || !n) {
      setErr("Phone and name are required.");
      return;
    }
    const normalizedNewRoles = sanitizeRolesForSave(newRoles, true, newRoles) as UiRole[];
    const primaryRole = pickPrimaryRole(normalizedNewRoles);
    const { error } = await supabase.from("staff").insert({
      phone: cleanPhone,
      name: n,
      role: primaryRole,
      roles: normalizedNewRoles,
      is_active: true,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setPhone("");
    setName("");
    setNewRoles(["worker"]);
    void load();
  }

  async function remove(row: StaffTableRow) {
    setErr(null);
    if (!window.confirm(`Delete ${row.name} permanently?`)) return;
    const { error } = await supabase.from("staff").delete().eq("id", row.id);
    if (error) {
      setErr(error.message);
      return;
    }
    void load();
  }

  async function resolveStaffLinkListingId(catalogServiceId: string, serviceName: string): Promise<string | null> {
    const cid = String(catalogServiceId || "").trim();
    const nm = String(serviceName || "").trim();
    let mapped = catalogIdToListingId[cid];
    if (!mapped) {
      for (const [k, v] of Object.entries(catalogIdToListingId)) {
        if (normId(k) === normId(cid)) {
          mapped = v;
          break;
        }
      }
    }
    if (mapped) return String(mapped);
    const probe = await supabase.from("service_listings").select("id").eq("id", cid).maybeSingle();
    if (!probe.error && probe.data?.id) return String(probe.data.id);
    if (nm) {
      const byName = await supabase.from("service_listings").select("id").eq("name", nm).maybeSingle();
      if (!byName.error && byName.data?.id) return String(byName.data.id);
      const byTrim = await supabase.from("service_listings").select("id").eq("name", nm.trim()).maybeSingle();
      if (!byTrim.error && byTrim.data?.id) return String(byTrim.data.id);
      const byIlike = await supabase.from("service_listings").select("id,name").ilike("name", nm);
      if (!byIlike.error && byIlike.data?.length === 1 && byIlike.data[0].id) return String(byIlike.data[0].id);
      const all = await supabase.from("service_listings").select("id,name");
      if (!all.error && all.data?.length) {
        const want = normServiceName(nm);
        for (const row of all.data as Array<{ id: string; name: string | null }>) {
          if (normServiceName(String(row.name || "")) === want) return String(row.id);
        }
      }
    }
    return null;
  }

  /** Если staff_services всё ещё ссылается на legacy `services`, нужен числовой id. */
  async function resolveLegacyServiceIdForStaffLink(rawCatalogId: string, serviceName: string): Promise<string | null> {
    const cid = String(rawCatalogId || "").trim();
    const nm = String(serviceName || "").trim();
    if (/^\d+$/.test(cid)) {
      const p = await supabase.from("services").select("id").eq("id", cid).maybeSingle();
      if (!p.error && p.data && (p.data as { id?: unknown }).id != null) return String((p.data as { id: unknown }).id);
    }
    if (nm) {
      const r1 = await supabase.from("services").select("id").eq("name_et", nm).limit(1).maybeSingle();
      if (!r1.error && r1.data && (r1.data as { id?: unknown }).id != null) return String((r1.data as { id: unknown }).id);
      const r2 = await supabase.from("services").select("id").eq("name", nm).limit(1).maybeSingle();
      if (!r2.error && r2.data && (r2.data as { id?: unknown }).id != null) return String((r2.data as { id: unknown }).id);
    }
    return null;
  }

  function isStaffServicesServiceFkError(msg: unknown): boolean {
    const m = String(msg || "").toLowerCase();
    return (
      m.includes("staff_services_service_id_fkey") ||
      (m.includes("foreign key") && m.includes("staff_services") && m.includes("service_id"))
    );
  }

  async function toggleService(staffId: string, serviceId: string, on: boolean) {
    setErr(null);
    const catalogSvc = activeServices.find((s) => String(s.id) === String(serviceId));
    const name = catalogSvc?.name || "";
    const rawId = String(serviceId);
    const explicitForStaff = links.filter((l) => String(l.staff_id) === String(staffId));

    /* Нет строк staff_services у мастера = по смыслу все услуги доступны; первый «выкл» ограничивает список */
    if (!on && explicitForStaff.length === 0) {
      const others = activeServices.filter((s) => String(s.id) !== String(serviceId));
      if (others.length === 0) {
        setErr(
          "Нельзя отключить единственную активную услугу: пустой список привязок в БД означает «все услуги». Добавьте в каталог ещё одну активную услугу или отключите мастера.",
        );
        return;
      }
      const { error: delErr } = await supabase.from("staff_services").delete().eq("staff_id", staffId);
      if (delErr) {
        setErr(delErr.message);
        return;
      }
      const failed: string[] = [];
      let inserted = 0;
      for (const s of others) {
        const r = await insertStaffServiceRow(staffId, s);
        if (r.ok) inserted++;
        else failed.push(s.name);
      }
      if (inserted === 0) {
        setErr(
          `Не удалось сохранить ни одной привязки (${failed.length ? `проблемные услуги: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}` : "FK staff_services"}). Проверьте страницу «Услуги» — должны быть строки в service_listings.`,
        );
        void load();
        return;
      }
      if (failed.length) {
        setErr(
          `Часть услуг не удалось привязать (${failed.length}): ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. Остальные сохранены — проверьте каталог и повторите.`,
        );
      }
      void load();
      return;
    }

    const listingId = await resolveStaffLinkListingId(rawId, name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, name);
    /* FK staff_services «гуляет» между UUID (после 012) и legacy bigint — пробуем все варианты. */
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];

    if (candidateIds.length === 0) {
      setErr(
        `Не удалось определить id услуги «${name || rawId}» для staff_services. Проверьте запись на странице «Услуги».`,
      );
      return;
    }

    if (on) {
      let lastFkMsg: string | null = null;
      for (const sid of candidateIds) {
        let { error } = await supabase
          .from("staff_services")
          .insert({ staff_id: staffId, service_id: sid, show_on_site: true });
        if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
          error = (await supabase.from("staff_services").insert({ staff_id: staffId, service_id: sid })).error ?? null;
        }
        if (!error) {
          void load();
          return;
        }
        const em = String(error.message || "").toLowerCase();
        if (em.includes("duplicate key") || em.includes("unique constraint")) {
          void load();
          return;
        }
        if (isStaffServicesServiceFkError(error.message) || em.includes("invalid input syntax") || em.includes("uuid")) {
          lastFkMsg = error.message;
          continue;
        }
        setErr(error.message);
        return;
      }
      setErr(
        `Не удалось сохранить привязку «${name || rawId}» — все кандидаты id упёрлись в FK/UUID. ` +
          (serviceListingsEmpty
            ? "Миграция 012 не применена: таблица service_listings пустая."
            : "В service_listings нет записи с таким UUID — синхронизируйте каталог на странице «Услуги».") +
          (lastFkMsg ? ` (БД: ${lastFkMsg})` : ""),
      );
      return;
    }

    let deleted = false;
    for (const sid of candidateIds) {
      const { error, data } = await supabase
        .from("staff_services")
        .delete()
        .eq("staff_id", staffId)
        .eq("service_id", sid)
        .select("staff_id");
      if (!error && data && data.length > 0) {
        deleted = true;
        break;
      }
    }
    if (!deleted) {
      /* fallback: может попасться запись, id которой в linking‑таблице не совпал ни с одним из наших id */
      const linkRow = links.find(
        (l) =>
          normId(l.staff_id) === normId(staffId) &&
          (normId(l.service_id) === normId(rawId) ||
            (listingId && normId(l.service_id) === normId(listingId)) ||
            (legacySvcId && normId(l.service_id) === normId(legacySvcId))),
      );
      if (linkRow) {
        await supabase.from("staff_services").delete().eq("staff_id", staffId).eq("service_id", linkRow.service_id);
      }
    }
    void load();
  }

  async function toggleShowOnSiteForLink(staffId: string, serviceId: string, show: boolean) {
    setErr(null);
    const catalogSvc = activeServices.find(
      (s) =>
        normId(s.id) === normId(serviceId) ||
        normId(catalogIdToListingId[String(s.id)] ?? s.id) === normId(serviceId),
    );
    const name = catalogSvc?.name || "";
    const rawId = String(serviceId);
    const listingId = await resolveStaffLinkListingId(rawId, name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, name);
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];

    if (candidateIds.length === 0) {
      setErr(
        `Не удалось сопоставить «${name || rawId}» с service_listings — обновите каталог на странице «Услуги».`,
      );
      return;
    }

    for (const sid of candidateIds) {
      const { error, data } = await supabase
        .from("staff_services")
        .update({ show_on_site: show })
        .eq("staff_id", staffId)
        .eq("service_id", sid)
        .select("staff_id");
      if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
        setErr(
          "Нужна миграция БД: staff_services.show_on_site (файл supabase/migrations/019_staff_services_show_on_site.sql).",
        );
        return;
      }
      if (error) {
        setErr(error.message);
        return;
      }
      if (data && data.length > 0) {
        void load();
        return;
      }
    }
    setErr("Не найдена привязка staff_services для этой услуги (проверьте id в каталоге).");
  }

  function hasLink(staffId: string, serviceId: string) {
    const explicit = links.filter((l) => String(l.staff_id) === String(staffId));
    if (explicit.length === 0) return true;
    let listingId = catalogIdToListingId[String(serviceId)];
    if (!listingId) {
      for (const [k, v] of Object.entries(catalogIdToListingId)) {
        if (normId(k) === normId(serviceId)) {
          listingId = v;
          break;
        }
      }
    }
    listingId ??= String(serviceId);
    return explicit.some(
      (l) =>
        normId(l.staff_id) === normId(staffId) &&
        (normId(l.service_id) === normId(serviceId) || normId(l.service_id) === normId(listingId)),
    );
  }

  function skillCatPanelKey(staffId: string, catName: string) {
    return `${staffId}::${catName}`;
  }

  function toggleSkillCategoryPanel(staffId: string, catName: string) {
    const k = skillCatPanelKey(staffId, catName);
    setSkillCategoryExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function categoryAllLinkedForStaff(staffId: string, catSvcs: CatalogSkillService[]): boolean {
    if (!catSvcs.length) return true;
    const explicit = links.filter((l) => String(l.staff_id) === String(staffId));
    if (explicit.length === 0) return true;
    return catSvcs.every((s) => hasLink(staffId, s.id));
  }

  async function deleteStaffServiceRow(staffId: string, s: CatalogSkillService): Promise<boolean> {
    const rawId = String(s.id);
    const listingId = await resolveStaffLinkListingId(rawId, s.name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, s.name);
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];
    for (const svcId of candidateIds) {
      const { error } = await supabase.from("staff_services").delete().eq("staff_id", staffId).eq("service_id", svcId);
      if (!error) return true;
    }
    return false;
  }

  async function insertStaffServiceRow(
    staffId: string,
    s: CatalogSkillService,
  ): Promise<{ ok: boolean; error?: string }> {
    const rawId = String(s.id);
    const listingId = await resolveStaffLinkListingId(rawId, s.name);
    const legacySvcId = await resolveLegacyServiceIdForStaffLink(rawId, s.name);
    /* FK схемы гуляет: 012 мигрирует на UUID service_listings, а старые базы держат bigint services.
     * Пробуем по очереди, на первой удачной — выходим. */
    const candidateIds = [...new Set([listingId, legacySvcId, rawId].filter((x): x is string => Boolean(x)))];
    if (!candidateIds.length) return { ok: false, error: `«${s.name}»: не удалось определить id для staff_services` };
    let lastFkMsg: string | null = null;
    for (const sid of candidateIds) {
      let { error } = await supabase
        .from("staff_services")
        .insert({ staff_id: staffId, service_id: sid, show_on_site: true });
      if (error && String(error.message || "").toLowerCase().includes("show_on_site")) {
        error = (await supabase.from("staff_services").insert({ staff_id: staffId, service_id: sid })).error ?? null;
      }
      if (!error) return { ok: true };
      const em = String(error.message || "").toLowerCase();
      if (em.includes("duplicate key") || em.includes("unique constraint")) return { ok: true };
      if (isStaffServicesServiceFkError(error.message) || em.includes("invalid input syntax") || em.includes("uuid")) {
        lastFkMsg = error.message;
        continue;
      }
      return { ok: false, error: error.message };
    }
    return { ok: false, error: lastFkMsg || "FK staff_services" };
  }

  async function toggleCategoryForStaff(staffId: string, catSvcs: CatalogSkillService[], turnOn: boolean) {
    setErr(null);
    if (!catSvcs.length) return;
    const catIdSet = new Set(catSvcs.map((s) => String(s.id)));
    const explicitForStaff = links.filter((l) => String(l.staff_id) === String(staffId));

    if (!turnOn) {
      if (explicitForStaff.length === 0) {
        const others = activeServices.filter((s) => !catIdSet.has(String(s.id)));
        if (others.length === 0) {
          setErr(
            "Нельзя отключить всю категорию: в каталоге нет услуг вне неё. Добавьте услуги в другой категории или снимайте отметки по одной услуге.",
          );
          return;
        }
        const { error: delErr } = await supabase.from("staff_services").delete().eq("staff_id", staffId);
        if (delErr) {
          setErr(delErr.message);
          return;
        }
        const failed: string[] = [];
        let inserted = 0;
        for (const s of others) {
          const r = await insertStaffServiceRow(staffId, s);
          if (r.ok) inserted++;
          else failed.push(s.name);
        }
        if (inserted === 0) {
          setErr(
            `Не удалось сохранить ни одной привязки (${failed.length ? `проблемные: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}` : "FK staff_services"}). Проверьте каталог на странице «Услуги».`,
          );
          void load();
          return;
        }
        if (failed.length) {
          setErr(
            `Часть услуг не удалось привязать (${failed.length}): ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. Остальные сохранены.`,
          );
        }
        void load();
        return;
      }
      for (const s of catSvcs) {
        await deleteStaffServiceRow(staffId, s);
      }
      void load();
      return;
    }

    if (explicitForStaff.length === 0) {
      return;
    }
    const failed: string[] = [];
    for (const s of catSvcs) {
      if (hasLink(staffId, s.id)) continue;
      const r = await insertStaffServiceRow(staffId, s);
      if (!r.ok) failed.push(s.name);
    }
    if (failed.length) {
      setErr(
        `Не удалось привязать ${failed.length} услуг${failed.length === 1 ? "у" : ""}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. ` +
          (serviceListingsEmpty
            ? "Сначала примените миграцию 012 (service_listings)."
            : "Проверьте запись в service_listings на странице «Услуги»."),
      );
    }
    void load();
  }

  function assignedServicesForStaff(staffId: string) {
    return links
      .filter((l) => String(l.staff_id) === String(staffId))
      .map((l) => {
        const sid = l.service_id != null ? String(l.service_id) : "";
        const svc = services.find(
          (s) =>
            normId(s.id) === normId(sid) ||
            normId(catalogIdToListingId[String(s.id)] ?? s.id) === normId(sid),
        );
        const catName = String(svc?.category_name || "").trim() || "Без категории";
        return {
          serviceId: sid,
          name: svc?.name?.trim() || (sid ? `Услуга ${sid}` : "Неизвестная услуга"),
          categoryName: catName,
          show_on_site: l.show_on_site !== false,
        };
      })
      .filter((x) => x.serviceId);
  }

  function groupAssignedByCategory(
    assigned: ReturnType<typeof assignedServicesForStaff>,
  ): { name: string; items: typeof assigned }[] {
    const m = new Map<string, typeof assigned>();
    for (const a of assigned) {
      const key = a.categoryName || "Без категории";
      if (!m.has(key)) m.set(key, [] as typeof assigned);
      m.get(key)!.push(a);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ru"))
      .map(([name, items]) => ({
        name,
        items: [...items].sort((x, y) => x.name.localeCompare(y.name, "ru")),
      }));
  }

  function assignedCatPanelKey(staffId: string, catName: string) {
    return `assigned::${staffId}::${catName}`;
  }
  function toggleAssignedCategoryPanel(staffId: string, catName: string) {
    const k = assignedCatPanelKey(staffId, catName);
    setSkillCategoryExpanded((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-5xl space-y-6 text-zinc-200">
      <header>
        <h1 className="text-xl font-semibold text-white">{t("nav.adminStaff")}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t("adminStaff.subtitle")}</p>
      </header>

      {staffMarketingColumnMissing && (
        <p className="rounded border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          В проекте БД нет колонки <code className="rounded bg-black/40 px-1">staff.show_on_marketing_site</code> — поэтому
          переключатели «Сайт / запись» не могут сохраниться. Откройте Supabase → SQL Editor и выполните файл{" "}
          <code className="rounded bg-black/40 px-1">supabase/migrations/020_staff_show_on_marketing_site.sql</code>
          (или <code className="rounded bg-black/40 px-1">supabase db push</code>), затем обновите эту страницу.
        </p>
      )}

      {serviceListingsEmpty && (
        <p className="rounded border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Таблица <code className="rounded bg-black/40 px-1">service_listings</code> пустая — CRM показывает услуги из
          старой таблицы <code className="rounded bg-black/40 px-1">services</code> с числовыми id, а{" "}
          <code className="rounded bg-black/40 px-1">staff_services.service_id</code> ждёт UUID. Поэтому переключатели
          услуг падают с ошибкой внешнего ключа. Запустите миграцию{" "}
          <code className="rounded bg-black/40 px-1">supabase/migrations/012_service_listings_fk.sql</code> или добавьте
          услуги в новой схеме на странице «Услуги», затем обновите эту страницу.
        </p>
      )}

      {err && (
        <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</p>
      )}

      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3 border border-zinc-800 bg-zinc-950 p-4">
        <div>
          <label className="block text-xs text-zinc-500">{t("login.phone")}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
            placeholder="37255686845"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">{t("adminStaff.name")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 rounded border border-zinc-700 bg-black px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">{t("role.label")}</label>
          <div className="mt-1 flex flex-wrap gap-3 rounded border border-zinc-700 bg-black px-2 py-1 text-sm">
            {(["admin", "manager", "worker"] as UiRole[]).map((r) => (
              <label key={r} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={newRoles.includes(r)}
                  onChange={(e) => setNewRoles((prev) => toggleRoleToken(prev, r, e.target.checked))}
                />
                {r === "admin" ? t("role.admin") : r === "manager" ? t("role.manager") : t("role.worker")}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500">
          {t("common.add")}
        </button>
      </form>

      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="border-b border-zinc-800 px-3 py-2">{t("login.phone")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.name")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.roleBrief")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">{t("adminStaff.active")}</th>
              <th className="min-w-[8rem] border-b border-zinc-800 px-3 py-2 text-xs font-normal text-zinc-500">
                Сайт / запись
              </th>
              <th className="min-w-[10rem] border-b border-zinc-800 px-3 py-2">{t("adminStaff.services")}</th>
              <th className="border-b border-zinc-800 px-3 py-2">actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const assigned = assignedServicesForStaff(r.id);
              const expanded = !!expandedById[r.id];
              return (
                <Fragment key={r.id}>
                  <tr className="border-b border-zinc-800/80 align-middle">
                    <td className="px-3 py-2 font-mono text-zinc-300">
                      {editingId === r.id ? (
                        <input
                          value={editPhone}
                          onChange={(e) => setEditPhone(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.phone ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === r.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-zinc-600 bg-black px-1 py-0.5 text-xs"
                        />
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2 text-xs text-zinc-400">{roleLabelsSummary(r)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ToggleSwitch
                          checked={r.is_active}
                          onCheckedChange={(v) => void updateStaffActive(r.id, v)}
                          aria-label={`${r.name}: активен в CRM`}
                        />
                        <span className="text-zinc-500">{r.is_active ? t("adminStaff.yes") : t("adminStaff.no")}</span>
                      </div>
                    </td>
                    <td className="max-w-[8rem] px-3 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <ToggleSwitch
                          disabled={staffMarketingColumnMissing}
                          checked={r.show_on_marketing_site !== false}
                          onCheckedChange={(v) => void updateStaffMarketingVisibility(r.id, v)}
                          aria-label={`${r.name}: на главном сайте и в публичной записи`}
                        />
                        <span className="text-zinc-500">
                          {r.show_on_marketing_site !== false ? t("adminStaff.yes") : t("adminStaff.no")}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-zinc-500">
                          {assigned.length === 0
                            ? t("adminStaff.assignedNone")
                            : t("adminStaff.assignedCount", { count: assigned.length })}
                        </span>
                        <button
                          type="button"
                          className="w-fit rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-left text-xs text-zinc-200 hover:border-zinc-500 hover:text-white"
                          onClick={() => toggleRowExpanded(r.id)}
                        >
                          {expanded ? t("adminStaff.collapseRow") : t("adminStaff.expandRow")}
                        </button>
                      </div>
                    </td>
                    <td className="space-x-2 px-3 py-2 whitespace-nowrap">
                      {editingId === r.id ? (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => void saveEdit()}>
                            {t("common.save")}
                          </button>
                          <button type="button" className="text-zinc-500 underline" onClick={() => setEditingId(null)}>
                            {t("common.cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="text-sky-400 underline" onClick={() => startEdit(r)}>
                            {t("adminStaff.edit")}
                          </button>
                          <button type="button" className="text-red-400 underline" onClick={() => void remove(r)}>
                            delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-zinc-800/80 bg-zinc-950/50 align-top">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="flex flex-col gap-4 text-sm">
                          <div>
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                              {t("role.label")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {(["admin", "manager", "worker"] as UiRole[]).map((roleToken) => {
                                const current = rowRoles(r);
                                return (
                                  <label key={roleToken} className="inline-flex items-center gap-1 text-xs text-zinc-300">
                                    <input
                                      type="checkbox"
                                      checked={current.includes(roleToken)}
                                      onChange={(e) =>
                                        void updateStaffRoles(
                                          r.id,
                                          current,
                                          toggleRoleToken(current, roleToken, e.target.checked),
                                        )
                                      }
                                    />
                                    {roleToken === "admin"
                                      ? t("role.admin")
                                      : roleToken === "manager"
                                        ? t("role.manager")
                                        : t("role.worker")}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                              <span className="text-[11px] font-medium uppercase text-zinc-500">{t("adminStaff.active")}</span>
                              <div className="flex items-center gap-2 text-xs">
                                <ToggleSwitch
                                  checked={r.is_active}
                                  onCheckedChange={(v) => void updateStaffActive(r.id, v)}
                                  aria-label={`${r.name}: активен в CRM`}
                                />
                                <span className="text-zinc-400">{r.is_active ? "Активен" : "Неактивен"}</span>
                              </div>
                              <span className="text-[10px] text-zinc-600">
                                {r.is_active ? "может входить и попадать в списки" : "не входит в работу салона"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1 rounded border border-zinc-800/80 p-2">
                              <span className="text-[11px] font-medium uppercase text-zinc-500">Сайт / запись</span>
                              <div className="flex items-center gap-2 text-xs">
                                <ToggleSwitch
                                  disabled={staffMarketingColumnMissing}
                                  checked={r.show_on_marketing_site !== false}
                                  onCheckedChange={(v) => void updateStaffMarketingVisibility(r.id, v)}
                                  aria-label={`${r.name}: на главном сайте и в публичной записи`}
                                />
                                <span className="text-zinc-400">
                                  {r.show_on_marketing_site !== false ? "виден" : "скрыт"}
                                </span>
                              </div>
                              <span className="text-[10px] leading-snug text-zinc-600">
                                Теневой режим: выключите для продакшена, включите — появится в блоке «Мастера» и в
                                онлайн-записи (для теста услуг).
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 rounded border border-zinc-800/80 bg-black/20 px-2 py-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                                Назначено явно
                              </p>
                              {assigned.length === 0 ? (
                                <p className="mt-1 text-xs text-zinc-500">
                                  Нет привязок к услугам. На услугах без своего списка мастеров этот мастер всё равно
                                  может подставляться вместе со всеми активными.
                                </p>
                              ) : (
                                <div className="mt-1 space-y-1.5">
                                  {groupAssignedByCategory(assigned).map(({ name: catName, items }, catIdx) => {
                                    const expanded = !!skillCategoryExpanded[assignedCatPanelKey(r.id, catName)];
                                    const assignedCatPanelId = `staff-${r.id}-assigned-catpanel-${catIdx}`;
                                    const siteCount = items.filter((x) => x.show_on_site).length;
                                    return (
                                      <div
                                        key={catName}
                                        className="rounded border border-zinc-800/60 bg-black/25"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => toggleAssignedCategoryPanel(r.id, catName)}
                                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                                          aria-expanded={expanded}
                                          aria-controls={assignedCatPanelId}
                                        >
                                          <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                            {expanded ? "▼" : "▶"}
                                          </span>
                                          <span className="min-w-0 flex-1 text-xs font-medium text-zinc-200">
                                            {catName}
                                          </span>
                                          <span className="shrink-0 text-[10px] text-zinc-500">
                                            {siteCount}/{items.length} на сайте
                                          </span>
                                        </button>
                                        {expanded && (
                                          <ul
                                            id={assignedCatPanelId}
                                            className="space-y-1.5 border-t border-zinc-800/50 px-2 py-2 text-xs text-zinc-200"
                                          >
                                            {items.map((a) => (
                                              <li
                                                key={a.serviceId}
                                                className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-800/60 pb-1 last:border-0 last:pb-0"
                                              >
                                                <span className="min-w-0 flex-1 font-medium text-zinc-100">
                                                  {a.name}
                                                </span>
                                                <span
                                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                                    a.show_on_site
                                                      ? "border border-emerald-800/60 text-emerald-300"
                                                      : "border border-amber-800/60 text-amber-200"
                                                  }`}
                                                >
                                                  {a.show_on_site ? "на сайте" : "только CRM"}
                                                </span>
                                                <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                                                  <ToggleSwitch
                                                    size="sm"
                                                    checked={a.show_on_site}
                                                    onCheckedChange={(v) =>
                                                      void toggleShowOnSiteForLink(r.id, a.serviceId, v)
                                                    }
                                                    aria-label={`${a.name}: на сайте`}
                                                  />
                                                  <span>сайт</span>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <p className="mb-1 text-[11px] text-zinc-500">
                              Сначала переключатель категории — все услуги в ней; раскройте категорию (▶), чтобы
                              отметить услуги по отдельности.
                            </p>
                            <div className="max-h-[min(28rem,70vh)] space-y-2 overflow-y-auto rounded border border-zinc-800/60 p-2">
                              {activeServicesByCategory.map(({ name: catName, services: catSvcs }, catIdx) => {
                                const expanded = !!skillCategoryExpanded[skillCatPanelKey(r.id, catName)];
                                const catAll = categoryAllLinkedForStaff(r.id, catSvcs);
                                const catPanelId = `staff-${r.id}-catpanel-${catIdx}`;
                                return (
                                  <div key={catName} className="rounded border border-zinc-800/60 bg-black/25">
                                    <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                                      <button
                                        type="button"
                                        onClick={() => toggleSkillCategoryPanel(r.id, catName)}
                                        className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800"
                                        aria-expanded={expanded}
                                        aria-controls={catPanelId}
                                        title={expanded ? "Свернуть список услуг" : "Показать услуги категории"}
                                      >
                                        {expanded ? "▼" : "▶"}
                                      </button>
                                      <span className="min-w-0 flex-1 text-xs font-medium text-zinc-200">
                                        {catName}
                                      </span>
                                      <span className="shrink-0 text-[10px] text-zinc-500">{catSvcs.length}</span>
                                      <ToggleSwitch
                                        size="sm"
                                        checked={catAll}
                                        onCheckedChange={(v) => void toggleCategoryForStaff(r.id, catSvcs, v)}
                                        aria-label={`${r.name}: все услуги «${catName}»`}
                                      />
                                    </div>
                                    {expanded && (
                                      <div
                                        id={catPanelId}
                                        className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-800/50 px-2 py-2"
                                      >
                                        {catSvcs.map((s) => (
                                          <div
                                            key={s.id}
                                            className="flex max-w-[11rem] items-center gap-1.5 text-xs text-zinc-400"
                                          >
                                            <ToggleSwitch
                                              size="sm"
                                              checked={hasLink(r.id, s.id)}
                                              onCheckedChange={(v) => void toggleService(r.id, s.id, v)}
                                              aria-label={`${r.name}: ${s.name}`}
                                            />
                                            <span className="min-w-0 truncate" title={s.name}>
                                              {s.name}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {activeServices.length === 0 && (
                                <p className="text-xs text-zinc-500">
                                  Каталог услуг пуст — добавьте услуги на странице «Услуги».
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
