import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "../lib/supabase";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useServicesCatalogRealtime } from "../hooks/useSalonRealtime";
import type { CategoryRow, ServiceRow, StaffMember } from "../types/database";
import { formatPriceEur } from "../lib/format";
import { listingPriceMaxCents, priceMaxEur } from "../lib/serviceListing";
import { normalizeRoles } from "../lib/roles";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useTheme } from "../context/ThemeContext";

const editableUi =
  "border border-gold/20 focus:border-gold/50 focus:ring-1 focus:ring-gold/20";
const fieldBase =
  "mt-1 w-full rounded-lg bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60";

function normServiceName(n: string): string {
  return String(n || "").trim().toLowerCase();
}

/** Сравнение staff_id / service_id из PostgREST (регистр, пробелы). */
function normId(id: string | number | null | undefined): string {
  return String(id ?? "")
    .trim()
    .toLowerCase();
}

/** Админы CRM не показываются в блоке «Мастера» у услуги. */
function isStaffSalonAdmin(m: StaffMember): boolean {
  return normalizeRoles(m.roles).includes("admin");
}

function staffListedAsMasters(members: StaffMember[]): StaffMember[] {
  return members.filter((m) => m.active && !isStaffSalonAdmin(m));
}

/** Услуга из публичного каталога (UUID), даже если catalogSource не проставлен. */
function rowFromServiceListings(s: ServiceRow): boolean {
  if (s.catalogSource === "listing") return true;
  const id = String(s.id ?? "").trim();
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

type ListingCatalogRow = {
  id: string;
  name?: string | null;
  price?: number | null;
  price_max?: number | null;
  duration?: number | null;
  category_id?: string | null;
  buffer_after_min?: number | null;
  is_active?: boolean | null;
  service_categories?: { name?: string | null } | null;
};

/** When `services` is empty but the public catalog has rows, hydrate the CRM list from service_listings. */
async function fetchServicesFromListingsCatalog(): Promise<ServiceRow[]> {
  /* Fallback по schema-drift (старые проекты без buffer_after_min/is_active).
   * `as typeof res` — потому что разные .select() дают разные generic-аргументы
   * у PostgrestSingleResponse, а TS отказывается их объединять. */
  let res = await supabase
    .from("service_listings")
    .select("id,name,price,price_max,duration,category_id,buffer_after_min,is_active,service_categories(name)")
    .order("name", { ascending: true });

  if (res.error && String(res.error.message || "").includes("buffer_after_min")) {
    res = (await supabase
      .from("service_listings")
      .select("id,name,price,price_max,duration,category_id,is_active,service_categories(name)")
      .order("name", { ascending: true })) as typeof res;
  }
  if (res.error && String(res.error.message || "").includes("is_active")) {
    res = (await supabase
      .from("service_listings")
      .select("id,name,price,price_max,duration,category_id,service_categories(name)")
      .order("name", { ascending: true })) as typeof res;
  }
  if (res.error || !res.data?.length) return [];

  return (res.data as ListingCatalogRow[]).map((r, idx) => {
    const catName = String(r.service_categories?.name || "").trim();
    return {
      id: String(r.id),
      slug: null,
      name_et: String(r.name || ""),
      name_en: null,
      category: catName || null,
      category_id: r.category_id != null ? String(r.category_id) : null,
      duration_min: Number(r.duration || 0),
      buffer_after_min: Number(r.buffer_after_min ?? 10),
      price_cents: Math.round(Number(r.price || 0) * 100),
      price_max_cents: listingPriceMaxCents(r.price_max),
      active: r.is_active !== false,
      sort_order: idx,
      catalogSource: "listing",
    };
  });
}

export function ServicesPage() {
  const { t } = useTranslation();
  const { canManage } = useEffectiveRole();
  const { theme } = useTheme();
  const isDark = theme === "onyx" || theme === "stone";
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  /* Зеркало `categories` в ref: колбэки (syncServiceToPublicCatalog/load)
   * читают актуальный справочник, не завися от него в массиве зависимостей —
   * иначе load пересоздаётся при каждом setCategories и зацикливает перезагрузку. */
  const categoriesRef = useRef<CategoryRow[]>([]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [headerEditCatId, setHeaderEditCatId] = useState<string | null>(null);
  const [headerEditDraft, setHeaderEditDraft] = useState("");
  /* Черновик имени услуги. Пишем сюда во время набора, чтобы НЕ трогать
   * `services` на каждый символ — иначе groupedServices пересортируется по
   * имени, DOM переупорядочивается, инпут теряет фокус и срабатывает blur.
   * Коммит в БД — только на blur/Enter. */
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [serviceSearch, setServiceSearch] = useState("");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [quickCreateCategory, setQuickCreateCategory] = useState<string | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPriceEur, setQuickPriceEur] = useState("30");
  const [quickDuration, setQuickDuration] = useState("60");
  const [quickBuffer, setQuickBuffer] = useState("10");
  const [quickActive, setQuickActive] = useState(true);
  const [quickStaffIds, setQuickStaffIds] = useState<string[]>([]);
  const [serviceStaffLinksMap, setServiceStaffLinksMap] = useState<
    Record<string, Array<{ staff_id: string; show_on_site: boolean }>>
  >({});
  const [publicListingNames, setPublicListingNames] = useState<Set<string>>(new Set());
  const [publicCheckLoading, setPublicCheckLoading] = useState(false);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);

  /* === Compact mode + persistent UI prefs ====================================
   * Большие салоны держат 30+ услуг — раскрытая «портянка» полей делает страницу
   * нечитабельной. Поэтому по дефолту услуга показывается одной строкой-сводкой,
   * а полный редактор открывается по клику (аккордеон). Категории тоже можно
   * сворачивать. Все предпочтения хранятся в localStorage, чтобы возврат
   * на страницу не «забывал» свёрнутое состояние. */
  /* v2: by default ALL categories start collapsed (см. effect ниже). v1
   * хранил пустой collapsedCategories, что означало «всё развёрнуто» —
   * при бампе ключа старые юзеры тоже один раз получат свернутый вид. */
  // v4 resets old category/card expansion prefs; service groups should open collapsed by default.
  const SERVICES_PREFS_KEY = "admin/services/v4";
  type ActiveFilter = "all" | "active" | "inactive";
  type SortBy = "name" | "price-asc" | "price-desc" | "duration-asc" | "duration-desc" | "masters-desc";
  type ServicesPrefs = {
    expandedServiceIds: string[];
    collapsedCategories: string[];
    filterActive: ActiveFilter;
    filterNoMasters: boolean;
    filterNotOnMain: boolean;
    filterCategoryIds: string[];
    sortBy: SortBy;
    showToolbar: boolean;
    /** true после того, как мы один раз свернули все категории по дефолту.
     * Без флага мы каждый раз сбрасывали бы пользовательские «развернул». */
    collapseAllInitialized: boolean;
  };
  const DEFAULT_PREFS: ServicesPrefs = {
    expandedServiceIds: [],
    collapsedCategories: [],
    filterActive: "all",
    filterNoMasters: false,
    filterNotOnMain: false,
    filterCategoryIds: [],
    sortBy: "name",
    showToolbar: false,
    collapseAllInitialized: false,
  };
  const loadPrefs = (): ServicesPrefs => {
    if (typeof window === "undefined") return DEFAULT_PREFS;
    try {
      const raw = window.localStorage.getItem(SERVICES_PREFS_KEY);
      if (!raw) return DEFAULT_PREFS;
      const parsed = JSON.parse(raw) as Partial<ServicesPrefs>;
      return {
        ...DEFAULT_PREFS,
        ...parsed,
        expandedServiceIds: [],
        collapsedCategories: [],
        filterCategoryIds: Array.isArray(parsed.filterCategoryIds) ? parsed.filterCategoryIds.map(String) : [],
      };
    } catch {
      return DEFAULT_PREFS;
    }
  };
  const initialPrefs = useMemo(loadPrefs, []);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialPrefs.expandedServiceIds));
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set());
  const [filterActive, setFilterActive] = useState<ActiveFilter>(initialPrefs.filterActive);
  const [filterNoMasters, setFilterNoMasters] = useState<boolean>(initialPrefs.filterNoMasters);
  const [filterNotOnMain, setFilterNotOnMain] = useState<boolean>(initialPrefs.filterNotOnMain);
  const [filterCategoryIds, setFilterCategoryIds] = useState<Set<string>>(() => new Set(initialPrefs.filterCategoryIds));
  const [sortBy, setSortBy] = useState<SortBy>(initialPrefs.sortBy);
  const [showToolbar, setShowToolbar] = useState<boolean>(initialPrefs.showToolbar);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: ServicesPrefs = {
      expandedServiceIds: [],
      collapsedCategories: [],
      filterActive,
      filterNoMasters,
      filterNotOnMain,
      filterCategoryIds: Array.from(filterCategoryIds),
      sortBy,
      showToolbar,
      collapseAllInitialized: false,
    };
    try {
      window.localStorage.setItem(SERVICES_PREFS_KEY, JSON.stringify(payload));
    } catch { /* quota / private mode — silently ignore */ }
  }, [expandedIds, openCats, filterActive, filterNoMasters, filterNotOnMain, filterCategoryIds, sortBy, showToolbar]);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleCategoryCollapsed(name: string) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function toggleCategoryFilter(id: string) {
    setFilterCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const filtersActive =
    filterActive !== "all" || filterNoMasters || filterNotOnMain || filterCategoryIds.size > 0 || sortBy !== "name";
  function resetFilters() {
    setFilterActive("all");
    setFilterNoMasters(false);
    setFilterNotOnMain(false);
    setFilterCategoryIds(new Set());
    setSortBy("name");
  }

  function categoryNameFromService(service: ServiceRow, catList: CategoryRow[] = categories): string {
    const direct = String(service.category || "").trim();
    if (direct) return direct;
    const byId = catList.find((c) => String(c.id) === String(service.category_id || ""));
    return String(byId?.name || "").trim();
  }

  function mapModernServices(rows: Array<Record<string, unknown>>): ServiceRow[] {
    return rows.map((r, idx) => {
      const priceNum = Number(r.price);
      return {
        id: String(r.id || ""),
        slug: null,
        name_et: String(r.name || ""),
        name_en: null,
        category: r.category != null ? String(r.category) : null,
        category_id: r.category != null ? String(r.category) : null,
        duration_min: Number(r.duration || 0),
        buffer_after_min: Number(r.buffer_after_min || 10),
        price_cents: Number.isFinite(priceNum) ? Math.round(priceNum * 100) : 0,
        price_max_cents: listingPriceMaxCents(r.price_max),
        active: r.active !== false && r.is_active !== false,
        sort_order: idx,
        created_at: r.created_at != null ? String(r.created_at) : undefined,
      };
    });
  }

  const syncServiceToPublicCatalog = useCallback(async (service: ServiceRow, categoriesOverride?: CategoryRow[]) => {
    const serviceName = String(service.name_et || "").trim();
    if (!serviceName) return;

    try {
      const catSource = categoriesOverride ?? categoriesRef.current;
      let categoryName = categoryNameFromService(service, catSource);
      if (!categoryName && service.category_id != null) {
        const catLegacy = await supabase.from("categories").select("name").eq("id", service.category_id).maybeSingle();
        categoryName = String(catLegacy.data?.name || "").trim();
      }
      if (!categoryName && service.category_id != null) {
        const catModern = await supabase.from("service_categories").select("name").eq("id", service.category_id).maybeSingle();
        categoryName = String(catModern.data?.name || "").trim();
      }

      let publicCategoryId: string | null = null;
      if (categoryName) {
        const existing = await supabase.from("service_categories").select("id").eq("name", categoryName).maybeSingle();
        if (existing.data?.id) {
          publicCategoryId = String(existing.data.id);
        } else {
          const inserted = await supabase
            .from("service_categories")
            .insert({ name: categoryName })
            .select("id")
            .single();
          publicCategoryId = inserted.data?.id ? String(inserted.data.id) : null;
        }
      }

      const syncPriceMax = priceMaxEur(service.price_max_cents);
      const payload = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
        price_max: syncPriceMax,
        duration: Number(service.duration_min || 0),
        buffer_after_min: Number(service.buffer_after_min || 10),
        category_id: publicCategoryId,
        is_active: service.active !== false,
      };
      const payloadNoBuffer = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
        price_max: syncPriceMax,
        duration: Number(service.duration_min || 0),
        category_id: publicCategoryId,
        is_active: service.active !== false,
      };
      const payloadMinimal = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
        price_max: syncPriceMax,
        duration: Number(service.duration_min || 0),
        category_id: publicCategoryId,
      };

      const existingListing = await supabase.from("service_listings").select("id").eq("name", serviceName).maybeSingle();
      if (existingListing.data?.id) {
        let { error } = await supabase.from("service_listings").update(payload).eq("id", existingListing.data.id);
        if (error && String(error.message || "").includes("buffer_after_min")) {
          const retry = await supabase.from("service_listings").update(payloadNoBuffer).eq("id", existingListing.data.id);
          error = retry.error || null;
        }
        if (error && String(error.message || "").includes("is_active")) {
          const retry = await supabase.from("service_listings").update(payloadMinimal).eq("id", existingListing.data.id);
          error = retry.error || null;
        }
        if (error) console.error("[services-sync] update service_listings failed", error);
      } else {
        let { error } = await supabase.from("service_listings").insert(payload);
        if (error && String(error.message || "").includes("buffer_after_min")) {
          const retry = await supabase.from("service_listings").insert(payloadNoBuffer);
          error = retry.error || null;
        }
        if (error && String(error.message || "").includes("is_active")) {
          const retry = await supabase.from("service_listings").insert(payloadMinimal);
          error = retry.error || null;
        }
        if (error) console.error("[services-sync] insert service_listings failed", error);
      }
    } catch (err) {
      console.error("[services-sync] syncServiceToPublicCatalog crashed", err);
    }
  }, []);

  const deleteServiceFromPublicCatalog = useCallback(async (service: ServiceRow) => {
    const serviceName = String(service.name_et || "").trim();
    if (!serviceName) return;
    try {
      const { error } = await supabase.from("service_listings").delete().eq("name", serviceName);
      if (error) console.error("[services-sync] delete service_listings failed", error);
    } catch (err) {
      console.error("[services-sync] deleteServiceFromPublicCatalog crashed", err);
    }
  }, []);

  const load = useCallback(async () => {
    let loadedCategories: CategoryRow[] = [];

    const cLegacy = await supabase.from("categories").select("*").order("created_at", { ascending: true });
    if (!cLegacy.error && cLegacy.data) {
      loadedCategories = cLegacy.data as CategoryRow[];
      setCategories(loadedCategories);
    } else {
      const cModern = await supabase.from("service_categories").select("id,name").order("created_at", { ascending: true });
      if (cModern.data) {
        loadedCategories = (cModern.data as Array<{ id: string; name: string }>).map((r) => ({
          id: String(r.id) as unknown as number,
          name: String(r.name || ""),
        }));
        setCategories(loadedCategories);
      }
    }

    let loadedServices: ServiceRow[] = [];
    /* Сначала service_listings: staff_services.service_id ссылается на их UUID (миграция 012). */
    const fromListingsFirst = await fetchServicesFromListingsCatalog();
    if (fromListingsFirst.length > 0) {
      loadedServices = fromListingsFirst;
    } else {
      const sLegacy = await supabase.from("services").select("*").order("sort_order", { ascending: true });
      if (!sLegacy.error && sLegacy.data && sLegacy.data.length > 0) {
        loadedServices = sLegacy.data as ServiceRow[];
      } else {
        let sModern = await supabase
          .from("services")
          .select("id,name,category,duration,buffer_after_min,price,created_at")
          .order("name", { ascending: true });
        if (sModern.error && String(sModern.error.message || "").includes("buffer_after_min")) {
          sModern = (await supabase
            .from("services")
            .select("id,name,category,duration,price,created_at")
            .order("name", { ascending: true })) as typeof sModern;
        }
        if (sModern.data && sModern.data.length > 0) {
          loadedServices = mapModernServices(sModern.data as Array<Record<string, unknown>>);
        }
      }
    }

    setServices(loadedServices);

    const linksByService: Record<string, Array<{ staff_id: string; show_on_site: boolean }>> = {};
    const svcIds = loadedServices.map((x) => String(x.id));
    const listMeta = await supabase.from("service_listings").select("id,name");
    const idsForStaffQuery = new Set<string>(svcIds);
    if (!listMeta.error && listMeta.data?.length) {
      for (const row of listMeta.data as Array<{ id: string }>) {
        idsForStaffQuery.add(String(row.id));
      }
    }
    const idList = [...idsForStaffQuery].filter(Boolean);
    if (idList.length > 0) {
      const lk = await supabase.from("staff_services").select("staff_id, service_id, show_on_site").in("service_id", idList);
      if (!lk.error && lk.data) {
        for (const row of lk.data as Array<{ staff_id: string; service_id: string; show_on_site?: boolean }>) {
          const sid = String(row.service_id);
          if (!linksByService[sid]) linksByService[sid] = [];
          linksByService[sid].push({
            staff_id: String(row.staff_id),
            show_on_site: row.show_on_site !== false,
          });
        }
      }
    }

    /* Строка услуги в CRM может быть с legacy id — дублируем привязки под ключом id строки в UI. */
    if (!listMeta.error && listMeta.data?.length && loadedServices.length) {
      const listingIdByNormName = new Map<string, string>();
      for (const row of listMeta.data as Array<{ id: string; name: string | null }>) {
        const k = normServiceName(String(row.name || ""));
        if (k) listingIdByNormName.set(k, String(row.id));
      }
      for (const svc of loadedServices) {
        const key = String(svc.id);
        if (linksByService[key]?.length) continue;
        const lid = listingIdByNormName.get(normServiceName(String(svc.name_et || "")));
        if (lid && linksByService[lid]?.length) {
          linksByService[key] = linksByService[lid]!.map((x) => ({ ...x }));
        }
      }
    }

    setServiceStaffLinksMap(linksByService);

    /* Главный сайт читает service_listings: подтягиваем отсутствующие строки из services (старые данные / ручной SQL). */
    const listingsProbe = await supabase.from("service_listings").select("name");
    if (!listingsProbe.error && listingsProbe.data && loadedServices.length) {
      const onMain = new Set(
        (listingsProbe.data as Array<{ name: string | null }>)
          .map((r) => String(r.name || "").trim().toLowerCase())
          .filter(Boolean)
      );
      for (const svc of loadedServices) {
        const nm = String(svc.name_et || "").trim();
        if (!nm || svc.active === false) continue;
        if (onMain.has(nm.toLowerCase())) continue;
        await syncServiceToPublicCatalog(svc, loadedCategories);
        onMain.add(nm.toLowerCase());
      }
      const pubAgain = await supabase.from("service_listings").select("name");
      if (!pubAgain.error && pubAgain.data) {
        setPublicListingNames(
          new Set(
            (pubAgain.data as Array<{ name: string | null }>)
              .map((r) => String(r.name || "").trim().toLowerCase())
              .filter(Boolean)
          )
        );
      }
    }

    const staffRes = await supabase.from("staff").select("id,name,phone,is_active,role,roles").order("name");
    if (!staffRes.error && staffRes.data) {
      setStaff(
        (staffRes.data as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          phone: r.phone != null ? String(r.phone) : null,
          active: r.is_active !== false,
          /* Нормализуем роли, чтобы `isStaffSalonAdmin` корректно скрывал админов
           * (техподдержка сайта) из списка мастеров услуги. */
          roles: normalizeRoles(r.roles ?? r.role),
        }))
      );
    }
    setLoading(false);
  }, [syncServiceToPublicCatalog]);

  const refreshPublicStatus = useCallback(async () => {
    setPublicCheckLoading(true);
    try {
      const resp = await supabase.from("service_listings").select("name");
      if (!resp.error && resp.data) {
        const names = new Set(
          (resp.data as Array<{ name: string | null }>)
            .map((r) => String(r.name || "").trim().toLowerCase())
            .filter(Boolean)
        );
        setPublicListingNames(names);
      }
    } finally {
      setPublicCheckLoading(false);
    }
  }, []);

  /** Полная выгрузка всех активных услуг в service_listings (цена, категория, сроки). */
  const syncAllServicesToPublicSite = useCallback(async () => {
    if (!canManage) return;
    for (const s of services) {
      if (s.active === false) continue;
      const nm = String(s.name_et || "").trim();
      if (!nm) continue;
      await syncServiceToPublicCatalog(s);
    }
    await refreshPublicStatus();
  }, [canManage, services, syncServiceToPublicCatalog, refreshPublicStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void refreshPublicStatus();
  }, [refreshPublicStatus]);

  useServicesCatalogRealtime(load);

  async function addCategory() {
    if (!newCat.trim() || !canManage) return;
    const categoryName = newCat.trim();
    const legacyInsert = await supabase.from("categories").insert({ name: categoryName });
    if (legacyInsert.error) {
      const modernInsert = await supabase.from("service_categories").insert({ name: categoryName });
      if (modernInsert.error && !String(modernInsert.error.message || "").toLowerCase().includes("duplicate")) {
        console.error("[services] add category failed", modernInsert.error);
      }
    } else {
      const mirror = await supabase.from("service_categories").insert({ name: categoryName });
      if (mirror.error && !String(mirror.error.message || "").toLowerCase().includes("duplicate")) {
        console.error("[services-sync] insert service_categories failed", mirror.error);
      }
    }
    setNewCat("");
    setShowNewCategoryInput(false);
    load();
  }

  async function renameCategoryTo(category: CategoryRow, nextNameInput: string) {
    if (!canManage) return;
    const oldName = String(category.name || "").trim();
    const nextName = String(nextNameInput || "").trim();
    if (!nextName || nextName === oldName) return;

    let updated = false;
    const legacy = await supabase.from("categories").update({ name: nextName }).eq("name", oldName);
    if (!legacy.error) {
      updated = true;
    }

    const modern = await supabase.from("service_categories").update({ name: nextName }).eq("name", oldName);
    if (!modern.error) {
      updated = true;
    }

    if (!updated) {
      console.error("[services] rename category failed", { legacy: legacy.error, modern: modern.error });
      return;
    }

    const servicesInCategory = services.filter((s) => categoryNameFromService(s) === oldName);
    for (const service of servicesInCategory) {
      await saveService({ ...service, category: nextName });
    }
    load();
  }

  async function deleteCategory(category: CategoryRow) {
    if (!canManage) return;
    const categoryName = String(category.name || "").trim();
    const servicesInCategory = services.filter((s) => categoryNameFromService(s) === categoryName);
    const extra =
      servicesInCategory.length > 0
        ? `\n\n${servicesInCategory.length} услуг перейдут в "Без категории".`
        : "";
    if (!window.confirm(`Удалить категорию "${categoryName}"?${extra}`)) return;

    for (const service of servicesInCategory) {
      await saveService({ ...service, category: null, category_id: null });
    }

    let removed = false;
    const legacy = await supabase.from("categories").delete().eq("name", categoryName);
    if (!legacy.error) removed = true;

    const modern = await supabase.from("service_categories").delete().eq("name", categoryName);
    if (!modern.error) removed = true;

    if (!removed) {
      console.error("[services] delete category failed", { legacy: legacy.error, modern: modern.error });
      return;
    }

    load();
  }

  async function saveService(s: ServiceRow) {
    if (!canManage) return;
    const categoryName = categoryNameFromService(s) || null;
    const rowId = String(s.id);

    if (rowFromServiceListings(s)) {
      const publicCategoryId =
        s.category_id != null && String(s.category_id).trim() !== "" ? String(s.category_id) : null;
      const priceMax = priceMaxEur(s.price_max_cents);
      const payload = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
        price_max: priceMax,
        duration: Number(s.duration_min || 0),
        buffer_after_min: Number(s.buffer_after_min || 10),
        category_id: publicCategoryId,
        is_active: s.active !== false,
      };
      const payloadNoBuffer = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
        price_max: priceMax,
        duration: Number(s.duration_min || 0),
        category_id: publicCategoryId,
        is_active: s.active !== false,
      };
      const payloadMinimal = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
        price_max: priceMax,
        duration: Number(s.duration_min || 0),
        category_id: publicCategoryId,
      };
      let res = await supabase.from("service_listings").update(payload).eq("id", rowId).select("id");
      let error = res.error;
      if (error && String(error.message || "").includes("buffer_after_min")) {
        res = await supabase.from("service_listings").update(payloadNoBuffer).eq("id", rowId).select("id");
        error = res.error || null;
      }
      if (error && String(error.message || "").includes("is_active")) {
        res = await supabase.from("service_listings").update(payloadMinimal).eq("id", rowId).select("id");
        error = res.error || null;
      }
      if (error) {
        console.error("[services] save listing failed", error);
        window.alert(`Не удалось сохранить услугу: ${error.message}`);
        return;
      }
      if (!res.data?.length) {
        window.alert(
          "В service_listings не найдена строка с этим id — изменения не применены. Обновите страницу или проверьте синхронизацию каталога.",
        );
        return;
      }
      await refreshPublicStatus();
      load();
      return;
    }

    const legacy = await supabase
      .from("services")
      .update({
        name_et: s.name_et,
        duration_min: s.duration_min,
        buffer_after_min: s.buffer_after_min,
        price_cents: s.price_cents,
        active: s.active,
        category_id: s.category_id,
        category: categoryName,
      })
      .eq("id", rowId);
    if (legacy.error) {
      let modern = await supabase
        .from("services")
        .update({
          name: s.name_et,
          duration: s.duration_min,
          buffer_after_min: s.buffer_after_min,
          price: Number(s.price_cents || 0) / 100,
          category: categoryName,
          active: s.active,
          is_active: s.active,
        })
        .eq("id", rowId);
      if (modern.error && String(modern.error.message || "").includes("buffer_after_min")) {
        modern = await supabase
          .from("services")
          .update({
            name: s.name_et,
            duration: s.duration_min,
            price: Number(s.price_cents || 0) / 100,
            category: categoryName,
            active: s.active,
            is_active: s.active,
          })
          .eq("id", rowId);
      }
      if (modern.error && String(modern.error.message || "").includes("is_active")) {
        modern = await supabase
          .from("services")
          .update({
            name: s.name_et,
            duration: s.duration_min,
            price: Number(s.price_cents || 0) / 100,
            category: categoryName,
            active: s.active,
          })
          .eq("id", rowId);
      }
      if (modern.error) {
        console.error("[services] save failed", modern.error);
        window.alert(`Не удалось сохранить услугу: ${modern.error.message}`);
        return;
      }
    }
    await syncServiceToPublicCatalog(s);
    await refreshPublicStatus();
    load();
  }

  async function deleteService(s: ServiceRow) {
    if (!canManage) return;
    if (!window.confirm(t("services.deleteConfirm", { name: s.name_et }))) return;

    if (rowFromServiceListings(s)) {
      await supabase.from("staff_services").delete().eq("service_id", String(s.id));
      const { error } = await supabase.from("service_listings").delete().eq("id", String(s.id));
      if (error) {
        window.alert(t("services.deleteFailed"));
        return;
      }
      await refreshPublicStatus();
      load();
      return;
    }

    const { count, error: cErr } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("service_id", s.id);
    if (cErr) return;
    if ((count ?? 0) > 0) {
      window.alert(t("services.deleteBlockedBookings"));
      return;
    }
    await supabase.from("staff_services").delete().eq("service_id", s.id);
    const { error } = await supabase.from("services").delete().eq("id", s.id);
    if (error) {
      window.alert(t("services.deleteFailed"));
      return;
    }
    await deleteServiceFromPublicCatalog(s);
    await refreshPublicStatus();
    load();
  }

  function openQuickCreate(categoryName: string) {
    setQuickCreateCategory(categoryName || "");
    setQuickName(i18n.t("services.newServiceDefault"));
    setQuickPriceEur("30");
    setQuickDuration("60");
    setQuickBuffer("10");
    setQuickActive(true);
    setQuickStaffIds([]);
  }

  function closeQuickCreate() {
    setQuickCreateCategory(null);
    setQuickName("");
    setQuickPriceEur("30");
    setQuickDuration("60");
    setQuickBuffer("10");
    setQuickActive(true);
    setQuickStaffIds([]);
  }

  function toggleQuickStaff(staffId: string) {
    setQuickStaffIds((prev) => (prev.includes(staffId) ? prev.filter((x) => x !== staffId) : [...prev, staffId]));
  }

  /**
   * staff_services.service_id после миграции 012 — UUID из service_listings.
   * В CRM у услуги может быть id из legacy `services`; ищем listing по id или по имени, при необходимости синкаем в публичный каталог.
   */
  async function resolveListingIdForStaffLinks(service: ServiceRow): Promise<string | null> {
    const sid = String(service.id || "").trim();
    const nameRaw = String(service.name_et || "").trim();
    if (!nameRaw) return null;

    if (rowFromServiceListings(service)) {
      const probe = await supabase.from("service_listings").select("id").eq("id", sid).maybeSingle();
      if (!probe.error && probe.data?.id) return String(probe.data.id);
    }

    const byName = await supabase.from("service_listings").select("id").eq("name", nameRaw).maybeSingle();
    if (!byName.error && byName.data?.id) return String(byName.data.id);

    const byIlike = await supabase.from("service_listings").select("id,name").ilike("name", nameRaw);
    if (!byIlike.error && byIlike.data?.length === 1 && byIlike.data[0].id) return String(byIlike.data[0].id);

    const all = await supabase.from("service_listings").select("id,name");
    if (!all.error && all.data?.length) {
      const want = normServiceName(nameRaw);
      for (const row of all.data as Array<{ id: string; name: string | null }>) {
        if (normServiceName(String(row.name || "")) === want) return String(row.id);
      }
    }

    const byId = await supabase.from("service_listings").select("id").eq("id", sid).maybeSingle();
    if (!byId.error && byId.data?.id) return String(byId.data.id);

    if (!rowFromServiceListings(service)) {
      await syncServiceToPublicCatalog(service);
      const again = await supabase.from("service_listings").select("id").eq("name", nameRaw).maybeSingle();
      if (!again.error && again.data?.id) return String(again.data.id);
    }

    return null;
  }

  /** Если FK staff_services всё ещё на legacy `services`, нужен числовой id. */
  async function resolveLegacyServiceIdForStaffLinks(service: ServiceRow): Promise<string | null> {
    const cid = String(service.id || "").trim();
    const nm = String(service.name_et || "").trim();
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

  /** @returns false если запись в БД не удалась */
  async function replaceServiceStaffLinks(
    service: ServiceRow,
    links: Array<{ staff_id: string; show_on_site: boolean }>,
  ): Promise<boolean> {
    const rawId = String(service.id || "").trim();
    const listingId = await resolveListingIdForStaffLinks(service);
    const legacyId = await resolveLegacyServiceIdForStaffLinks(service);
    const candidateIds = [...new Set([listingId, rawId, legacyId].filter((x): x is string => Boolean(x)))];

    if (candidateIds.length === 0) {
      window.alert(
        `Не удалось определить id услуги в БД для «${String(service.name_et || "").trim() || service.id}». Проверьте каталог и синхронизацию с service_listings.`,
      );
      return false;
    }

    // If no links exist for service, backend treats it as "all staff can perform service".
    // We keep explicit links only when at least one staff member is selected.
    const { error: delErr } = await supabase.from("staff_services").delete().in("service_id", candidateIds);
    if (delErr) {
      console.error("[services] clear staff links failed", delErr);
      window.alert(`Не удалось обновить привязки мастеров: ${delErr.message || "ошибка"}.`);
      return false;
    }
    if (!links.length) return true;

    let lastFkMsg: string | null = null;
    for (const svcId of candidateIds) {
      const rows = links.map((l) => ({
        staff_id: l.staff_id,
        service_id: svcId,
        show_on_site: l.show_on_site,
      }));
      let { error: insErr } = await supabase.from("staff_services").insert(rows);
      if (insErr && String(insErr.message || "").toLowerCase().includes("show_on_site")) {
        const legacyRows = links.map((l) => ({ staff_id: l.staff_id, service_id: svcId }));
        insErr = (await supabase.from("staff_services").insert(legacyRows)).error ?? null;
      }
      if (!insErr) return true;
      const em = String(insErr.message || "").toLowerCase();
      if (em.includes("duplicate key") || em.includes("unique constraint")) return true;
      if (isStaffServicesServiceFkError(insErr.message)) {
        lastFkMsg = insErr.message;
        continue;
      }
      console.error("[services] create staff links failed", insErr);
      window.alert(`Не удалось сохранить привязки мастеров: ${insErr.message || "ошибка"}.`);
      return false;
    }

    window.alert(
      lastFkMsg ||
        "Не удалось сохранить привязки мастеров: ни один вариант service_id не подошёл к ограничению FK в вашей базе.",
    );
    return false;
  }

  function staffLinksForService(serviceId: string) {
    const k = String(serviceId);
    const direct = serviceStaffLinksMap[k];
    if (direct?.length) return direct;
    const want = normId(k);
    for (const [key, rows] of Object.entries(serviceStaffLinksMap)) {
      const list = rows as Array<{ staff_id: string; show_on_site: boolean }>;
      if (normId(key) === want && list.length) return list;
    }
    return [];
  }

  async function createServiceFromQuickForm() {
    if (!canManage || quickCreateCategory == null) return;
    const serviceName = String(quickName || "").trim();
    if (!serviceName) {
      window.alert("Введите название услуги.");
      return;
    }

    const priceEur = Number(quickPriceEur);
    const durationMin = Number(quickDuration);
    const bufferMin = Number(quickBuffer);
    if (!Number.isFinite(priceEur) || priceEur < 0) {
      window.alert("Цена должна быть числом >= 0.");
      return;
    }
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      window.alert("Длительность должна быть больше 0 минут.");
      return;
    }
    if (!Number.isFinite(bufferMin) || bufferMin < 0) {
      window.alert("Пауза должна быть числом >= 0.");
      return;
    }

    const categoryName = String(quickCreateCategory || "").trim();
    const found = categories.find((c) => String(c.name || "").trim() === categoryName);
    const categoryId = found ? String(found.id) : null;

    let insertRes = await supabase
      .from("services")
      .insert({
        name_et: serviceName,
        duration_min: Math.round(durationMin),
        buffer_after_min: Math.round(bufferMin),
        price_cents: Math.round(priceEur * 100),
        active: quickActive,
        sort_order: services.length,
        category_id: categoryId,
        category: categoryName || null,
      })
      .select("*")
      .single();

    if (insertRes.error) {
      insertRes = await supabase
        .from("services")
        .insert({
          name: serviceName,
          duration: Math.round(durationMin),
          buffer_after_min: Math.round(bufferMin),
          price: Number(priceEur.toFixed(2)),
          category: categoryName || null,
        })
        .select("*")
        .single();
      if (insertRes.error && String(insertRes.error.message || "").includes("buffer_after_min")) {
        insertRes = await supabase
          .from("services")
          .insert({
            name: serviceName,
            duration: Math.round(durationMin),
            price: Number(priceEur.toFixed(2)),
            category: categoryName || null,
          })
          .select("*")
          .single();
      }
    }

    if (insertRes.error) {
      console.error("[services] quick create failed", insertRes.error);
      window.alert("Не удалось создать услугу. Проверьте права и структуру таблицы.");
      return;
    }

    if (insertRes.data) {
      const row = insertRes.data as Record<string, unknown>;
      const normalized =
        row.name_et != null
          ? ({ ...(insertRes.data as ServiceRow), active: quickActive } as ServiceRow)
          : ({ ...mapModernServices([row])[0], active: quickActive } as ServiceRow);
      await syncServiceToPublicCatalog(normalized);
      await replaceServiceStaffLinks(normalized, quickStaffIds.map((id) => ({ staff_id: id, show_on_site: true })));
    }

    closeQuickCreate();
    await refreshPublicStatus();
    load();
  }

  const groupedServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    const allowedCategoryNames = filterCategoryIds.size > 0
      ? new Set(
          categories
            .filter((c) => filterCategoryIds.has(String(c.id)))
            .map((c) => String(c.name || "").trim()),
        )
      : null;

    let pool = services;
    if (q) pool = pool.filter((s) => String(s.name_et || "").toLowerCase().includes(q));
    if (filterActive === "active") pool = pool.filter((s) => s.active !== false);
    if (filterActive === "inactive") pool = pool.filter((s) => s.active === false);
    if (filterNoMasters) {
      pool = pool.filter((s) => staffLinksForService(String(s.id)).length === 0);
    }
    if (filterNotOnMain) {
      pool = pool.filter((s) => !publicListingNames.has(String(s.name_et || "").trim().toLowerCase()));
    }
    if (allowedCategoryNames) {
      pool = pool.filter((s) => allowedCategoryNames.has(categoryNameFromService(s) || ""));
    }

    const compare = (a: ServiceRow, b: ServiceRow): number => {
      switch (sortBy) {
        case "price-asc": return Number(a.price_cents || 0) - Number(b.price_cents || 0);
        case "price-desc": return Number(b.price_cents || 0) - Number(a.price_cents || 0);
        case "duration-asc": return Number(a.duration_min || 0) - Number(b.duration_min || 0);
        case "duration-desc": return Number(b.duration_min || 0) - Number(a.duration_min || 0);
        case "masters-desc":
          return staffLinksForService(String(b.id)).length - staffLinksForService(String(a.id)).length;
        case "name":
        default:
          return String(a.name_et || "").localeCompare(String(b.name_et || ""), "ru");
      }
    };

    const map = new Map<string, ServiceRow[]>();
    for (const service of pool) {
      const categoryName = categoryNameFromService(service) || "Без категории";
      if (!map.has(categoryName)) map.set(categoryName, []);
      map.get(categoryName)?.push(service);
    }
    /* Show empty category sections too when no search/filter is active. */
    const noFilters = !q && filterActive === "all" && !filterNoMasters && !filterNotOnMain && filterCategoryIds.size === 0;
    if (noFilters) {
      for (const c of categories) {
        const name = String(c.name || "").trim();
        if (name && name !== "Все услуги" && !map.has(name)) map.set(name, []);
      }
    }
    for (const list of map.values()) list.sort(compare);
    /* Порядок категорий = порядок в `categories` (загружаем по created_at,
     * поэтому новые добавленные категории оказываются в конце списка).
     * Категории, которых нет в справочнике, идут после известных. */
    const catOrder = new Map<string, number>();
    categories.forEach((c, i) => catOrder.set(String(c.name || "").trim(), i));
    return Array.from(map.entries())
      .filter(([categoryName]) => categoryName !== "Без категории")
      .sort((a, b) => {
        const ia = catOrder.has(a[0]) ? catOrder.get(a[0])! : Number.MAX_SAFE_INTEGER;
        const ib = catOrder.has(b[0]) ? catOrder.get(b[0])! : Number.MAX_SAFE_INTEGER;
        if (ia !== ib) return ia - ib;
        return a[0].localeCompare(b[0], "ru");
      });
  }, [
    services, categories, serviceSearch,
    filterActive, filterNoMasters, filterNotOnMain, filterCategoryIds,
    sortBy, publicListingNames, serviceStaffLinksMap,
  ]);

  /** Все id услуг, прошедшие текущие фильтры (для счётчика «найдено»). */
  const visibleServiceIds = useMemo(() => {
    const out: string[] = [];
    for (const [, list] of groupedServices) for (const s of list) out.push(String(s.id));
    return out;
  }, [groupedServices]);

  /** Quick top-of-page stats: active/total services + masters coverage. */
  const servicesStats = useMemo(() => {
    const total = services.length;
    const active = services.filter((s) => s.active).length;
    const onSite = publicListingNames.size;
    /* «Без мастеров» — активные услуги, у которых в staff_services нет ни одной
     * привязки. Совпадает с подсветкой карточек ниже (см. noMasters в списке)
     * и с фильтром filterNoMasters в тулбаре, чтобы клик по чипу открывал ровно
     * те же карточки, что выделены жёлтым. */
    const noMasters = services.filter(
      (s) => s.active && staffLinksForService(String(s.id)).length === 0,
    ).length;
    return { total, active, onSite, noMasters };
  }, [services, publicListingNames, serviceStaffLinksMap]);

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      {/* ───── Page header ───── */}
      <header className="pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{t("services.title")}</h1>

            {/* Stat chips */}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isDark ? "border-sky-300/15 bg-sky-300/[0.06] text-sky-200/80" : "border-sky-500/25 bg-sky-500/[0.08] text-sky-700"}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-sky-300/60" : "bg-sky-500/70"}`} />
                Всего услуг: <strong className="font-semibold">{servicesStats.total}</strong>
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isDark ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200/80" : "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700"}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-emerald-300/60" : "bg-emerald-500/70"}`} />
                Активных: <strong className="font-semibold">{servicesStats.active}</strong>
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${isDark ? "border-amber-300/15 bg-amber-300/[0.06] text-amber-200/80" : "border-amber-500/25 bg-amber-500/[0.08] text-amber-700"}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isDark ? "bg-amber-300/60" : "bg-amber-500/70"}`} />
                На главной: <strong className="font-semibold">{servicesStats.onSite}</strong>
                {publicCheckLoading && <span className="ml-1 opacity-70">(проверка…)</span>}
              </span>
              {/* Кликабельный чип «Без мастеров» — переключает тот же фильтр,
                * что и кнопка в тулбаре, чтобы из шапки можно было сразу
                * увидеть только проблемные услуги. Подсвечен красным, если
                * есть хоть одна такая услуга — иначе нейтральный серый. */}
              <button
                type="button"
                onClick={() => setFilterNoMasters((v) => !v)}
                title={
                  servicesStats.noMasters > 0
                    ? "Показать только услуги без назначенных мастеров"
                    : "Все активные услуги имеют хотя бы одного мастера"
                }
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition " +
                  (servicesStats.noMasters > 0
                    ? (filterNoMasters
                        ? (isDark ? "border-rose-300/40 bg-rose-300/[0.12] text-rose-100" : "border-rose-500/40 bg-rose-500/[0.12] text-rose-700")
                        : (isDark ? "border-rose-300/15 bg-rose-300/[0.06] text-rose-200/80 hover:border-rose-300/30 hover:bg-rose-300/[0.1]" : "border-rose-500/25 bg-rose-500/[0.06] text-rose-700 hover:border-rose-500/40 hover:bg-rose-500/[0.1]"))
                    : (filterNoMasters
                        ? "border-gold/30 bg-surface/60 text-fg"
                        : "border-line/10 bg-surface/40 text-fg hover:border-line/20"))
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (servicesStats.noMasters > 0 ? (isDark ? "bg-rose-300/60" : "bg-rose-500/70") : "bg-muted")
                  }
                />
                Без мастеров: <strong className="font-semibold">{servicesStats.noMasters}</strong>
              </button>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => void refreshPublicStatus()}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-line/[0.06] hover:text-fg"
                title="Проверить главную — сверить CRM со списком услуг, который видит сайт"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
              </button>
              <button
                type="button"
                onClick={() => void syncAllServicesToPublicSite()}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gold transition hover:bg-gold/[0.1]"
                title="Обновить всё на сайте — записывает все активные услуги из CRM в таблицу для главного сайта (service_listings)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M12 3v12m-4-4 4 4 4-4M4 21h16" /></svg>
              </button>
            </div>
          )}
        </div>

        {/* Search + filters toolbar */}
        {services.length > 4 && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 max-w-md">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input
                  type="search"
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="Поиск по названию услуги…"
                  className="w-full rounded-lg border border-line/20 bg-surface pl-8 pr-8 py-2 text-sm text-fg placeholder:text-muted focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
                {serviceSearch && (
                  <button
                    type="button"
                    onClick={() => setServiceSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-surface hover:text-fg"
                    aria-label="Очистить поиск"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowToolbar((v) => !v)}
                className={
                  "relative flex h-9 w-9 items-center justify-center rounded-lg transition " +
                  (filtersActive
                    ? "text-gold hover:bg-gold/[0.1]"
                    : "text-muted hover:bg-line/[0.06] hover:text-fg")
                }
                aria-expanded={showToolbar}
                title="Фильтры и сортировка"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
                {filtersActive && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-semibold text-black">
                    {[
                      filterActive !== "all" ? 1 : 0,
                      filterNoMasters ? 1 : 0,
                      filterNotOnMain ? 1 : 0,
                      filterCategoryIds.size,
                      sortBy !== "name" ? 1 : 0,
                    ].reduce((a, b) => a + b, 0)}
                  </span>
                )}
              </button>

              {(serviceSearch || filtersActive) && (
                <div className="ml-auto text-xs text-muted">
                  {visibleServiceIds.length} из {services.length} найдено
                </div>
              )}
            </div>

            {showToolbar && (
              <div className="rounded-xl border border-gold/10 bg-canvas/40 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted">Статус:</span>
                  {([
                    { id: "all", label: "Все" },
                    { id: "active", label: "Только активные" },
                    { id: "inactive", label: "Только выключенные" },
                  ] as Array<{ id: ActiveFilter; label: string }>).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setFilterActive(opt.id)}
                      className={
                        "rounded-full border px-3 py-1 text-xs font-medium transition " +
                        (filterActive === opt.id
                          ? "border-gold/40 bg-gold/[0.1] text-gold"
                          : "border-line/20 bg-surface/40 text-fg hover:border-line/30 hover:text-fg")
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted">Проблемы:</span>
                  <button
                    type="button"
                    onClick={() => setFilterNoMasters((v) => !v)}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition " +
                      (filterNoMasters
                        ? "border-gold/40 bg-gold/[0.1] text-gold"
                        : "border-line/20 bg-surface/40 text-fg hover:border-line/20 hover:text-fg")
                    }
                    title="Услуги, которые никто не выполняет"
                  >
                    <span aria-hidden="true">⚠</span> Без мастеров
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterNotOnMain((v) => !v)}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition " +
                      (filterNotOnMain
                        ? "border-gold/40 bg-gold/[0.1] text-gold"
                        : "border-line/20 bg-surface/40 text-fg hover:border-line/20 hover:text-fg")
                    }
                    title="Услуги, которых ещё нет на сайте"
                  >
                    Не на главной
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-muted">Сортировка:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className="rounded-lg border border-line/20 bg-surface px-2.5 py-1 text-xs text-fg focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30"
                  >
                    <option value="name">по названию (А → Я)</option>
                    <option value="price-asc">цена ↑</option>
                    <option value="price-desc">цена ↓</option>
                    <option value="duration-asc">длительность ↑</option>
                    <option value="duration-desc">длительность ↓</option>
                    <option value="masters-desc">больше мастеров — выше</option>
                  </select>
                </div>

                {categories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-muted">Категории:</span>
                    {categories.map((c) => {
                      const id = String(c.id);
                      const checked = filterCategoryIds.has(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleCategoryFilter(id)}
                          className={
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition " +
                            (checked
                              ? "border-gold/40 bg-gold/[0.1] text-gold"
                              : "border-line/20 bg-surface/40 text-muted hover:border-line/30 hover:text-fg")
                          }
                        >
                          {c.name}
                        </button>
                      );
                    })}
                    {filterCategoryIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setFilterCategoryIds(new Set())}
                        className="rounded-full border border-line/15 px-2 py-0.5 text-[10px] text-muted hover:border-line/25 hover:text-fg"
                      >
                        очистить
                      </button>
                    )}
                  </div>
                )}

                {filtersActive && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline"
                    >
                      Сбросить все фильтры
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* ───── Categories: только заголовок + «+» для добавления ───── */}
      {canManage && (
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-fg">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-gold"><path d="M3 6h18M3 12h18M3 18h12" /></svg>
            {t("services.categories")}
          </h2>
          {showNewCategoryInput ? (
            <input
              autoFocus
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onBlur={() => { if (!newCat.trim()) setShowNewCategoryInput(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addCategory();
                  setShowNewCategoryInput(false);
                }
                if (e.key === "Escape") { setNewCat(""); setShowNewCategoryInput(false); }
              }}
              placeholder={t("services.categoryPlaceholder")}
              className="w-56 rounded-lg border border-gold/40 bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-muted outline-none ring-1 ring-gold/20"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowNewCategoryInput(true)}
              className="flex h-7 w-7 items-center justify-center rounded text-muted transition hover:bg-line/[0.07] hover:text-fg"
              title="Добавить категорию"
              aria-label="Добавить категорию"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
        </div>
      )}

      <div className="space-y-6">
        {groupedServices.map(([categoryName, list]) => {
          const activeCount = list.filter((s) => s.active).length;
          /* Те же определения, что для отдельных карточек ниже — иначе у нас
           * счётчик в шапке расходился бы с подсветкой строк, и юзер думал
           * бы «бейдж врёт». noMasters/notOnSite считаем только среди активных
           * услуг, потому что выключенные и так не видны клиенту. */
          const noMastersCount = list.filter(
            (s) => s.active && staffLinksForService(String(s.id)).length === 0,
          ).length;
          const notOnSiteCount = list.filter(
            (s) =>
              s.active &&
              !publicListingNames.has(String(s.name_et || "").trim().toLowerCase()),
          ).length;
          const isCatCollapsed = !openCats.has(categoryName);
          const categoryForGroup =
            categoryName === "Без категории"
              ? null
              : categories.find((c) => String(c.name || "").trim() === categoryName) ??
                ({ id: categoryName as unknown as number, name: categoryName } as CategoryRow);
          return (
          <section
            key={categoryName}
            className="overflow-hidden rounded-2xl border border-gold/15 bg-panel/60"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/10 px-5 py-3">
              <div className="group flex items-center gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => toggleCategoryCollapsed(categoryName)}
                  className="flex shrink-0 items-center gap-1.5 rounded p-0.5 text-muted hover:text-fg focus:outline-none"
                  aria-expanded={!isCatCollapsed}
                  title={isCatCollapsed ? "Развернуть категорию" : "Свернуть категорию"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-3.5 w-3.5 shrink-0 transition ${isCatCollapsed ? "-rotate-90" : ""}`}
                    aria-hidden="true"
                  ><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {canManage && categoryForGroup && headerEditCatId === String(categoryForGroup.id) ? (
                  <input
                    value={headerEditDraft}
                    autoFocus
                    onChange={(e) => setHeaderEditDraft(e.target.value)}
                    onBlur={() => {
                      void renameCategoryTo(categoryForGroup, headerEditDraft);
                      setHeaderEditCatId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                      if (e.key === "Escape") setHeaderEditCatId(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-gold/40 bg-surface/50 px-2 py-0.5 text-sm font-semibold text-fg outline-none ring-1 ring-gold/20"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleCategoryCollapsed(categoryName)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <h3 className="truncate text-sm font-semibold text-fg">{categoryName}</h3>
                    </button>
                    <span className="shrink-0 rounded-full bg-surface/70 px-2 py-0.5 text-[10px] font-medium text-muted">
                      {list.length}
                    </span>
                    {activeCount < list.length && (
                      <span className="shrink-0 text-[10px] text-muted/50">{activeCount}/{list.length}</span>
                    )}
                    {canManage && categoryForGroup && (
                      <button
                        type="button"
                        onClick={() => { setHeaderEditCatId(String(categoryForGroup.id)); setHeaderEditDraft(categoryName); }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-line/[0.08] hover:text-fg"
                        title="Переименовать категорию"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                    {noMastersCount > 0 && (
                      <span className="text-[10px] text-gold/40" title={`Без назначенных мастеров: ${noMastersCount}. Услуги скрыты на сайте, никто их не возьмёт.`}> {noMastersCount} без мастеров</span>
                    )}
                    {notOnSiteCount > 0 && (
                      <span className="text-[10px] text-muted/40" title={`Не опубликовано на главном сайте: ${notOnSiteCount}. Нажмите «Обновить всё на сайте» вверху страницы.`}>· {notOnSiteCount} не на сайте</span>
                    )}
                  </>
                )}
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  {categoryForGroup && (
                    <>
                      <button
                        type="button"
                        onClick={() => void deleteCategory(categoryForGroup)}
                        className="flex h-7 w-7 items-center justify-center rounded text-rose-300/60 transition hover:bg-rose-300/[0.08] hover:text-rose-300/90"
                        title="Удалить категорию"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                    className="flex h-7 w-7 items-center justify-center rounded text-muted transition hover:bg-line/[0.07] hover:text-fg"
                    title="Добавить услугу"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
              )}
            </header>

            {!isCatCollapsed && (
            <div className="space-y-2 p-3">
              {list.map((s) => {
                const existsOnMain = publicListingNames.has(String(s.name_et || "").trim().toLowerCase());
                /* «Никто не делает» = в staff_services нет ни одной строки для услуги.
                 * Подсветим карточку жёлтым, чтобы такие услуги бросались в глаза
                 * в общем списке — иначе они теряются среди корректно настроенных. */
                const masterLinksCount = staffLinksForService(String(s.id)).length;
                const noMasters = s.active && masterLinksCount === 0;
                const isExpanded = expandedIds.has(String(s.id));
                return (
                <article
                  key={s.id}
                  className="group relative overflow-hidden rounded-xl border border-gold/10 bg-line/[0.02] transition hover:border-gold/20"
                >
                  {/* === Compact summary row (always visible) === */}
                  <div className="flex items-center gap-2 px-3 py-2 pl-4">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(String(s.id))}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition hover:bg-line/[0.02] focus:outline-none focus:bg-line/[0.04]"
                      aria-expanded={isExpanded}
                      title={isExpanded ? "Свернуть карточку" : "Раскрыть карточку для редактирования"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`h-3.5 w-3.5 shrink-0 text-muted transition ${isExpanded ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      ><path d="m6 9 6 6 6-6" /></svg>
                      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${s.active ? "text-fg" : "text-muted/50 line-through"}`}>
                        {String(s.name_et || "").trim() || <span className="italic text-muted">без названия</span>}
                      </span>
                      <span className="hidden sm:inline-flex shrink-0 items-center gap-2 text-[11px] text-muted tabular-nums">
                        <span className="font-medium text-fg tabular-nums">
                          {formatPriceEur(s.price_cents, s.price_max_cents)}
                        </span>
                        <span title="Длительность">
                          {Number(s.duration_min || 0)} мин
                        </span>
                        {Number(s.buffer_after_min || 0) > 0 && (
                          <span className="text-muted" title="Пауза после услуги">
                            +{Number(s.buffer_after_min || 0)}
                          </span>
                        )}
                        {noMasters ? (
                          <span className="text-[10px] text-gold/50" title="Услугу никто не выполняет">без мастеров</span>
                        ) : (
                          <span className="text-[10px] text-muted tabular-nums" title={`Назначено мастеров: ${masterLinksCount}`}>👤 {masterLinksCount}</span>
                        )}
                        {!existsOnMain && s.active && (
                          <span className="text-[10px] text-muted/50" title="Услуга не опубликована на сайте">· не на сайте</span>
                        )}
                      </span>
                    </button>
                    <div
                      className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ToggleSwitch
                        disabled={!canManage}
                        checked={s.active}
                        onCheckedChange={(active) => {
                          const updated = { ...s, active };
                          setServices((prev) =>
                            prev.map((x) => (String(x.id) === String(s.id) ? updated : x)),
                          );
                          void saveService(updated);
                        }}
                        aria-label={`${s.name_et}: услуга активна`}
                      />
                    </div>
                  </div>

                  {/* === Mobile-only chips line (sm:hidden) === */}
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-2 sm:hidden text-[11px] text-muted tabular-nums">
                    <span className="font-medium text-fg">{formatPriceEur(s.price_cents, s.price_max_cents)}</span>
                    <span>{Number(s.duration_min || 0)} мин</span>
                    {Number(s.buffer_after_min || 0) > 0 && <span>+{Number(s.buffer_after_min || 0)}</span>}
                    {noMasters ? (
                      <span className="text-gold/50">без мастеров</span>
                    ) : (
                      <span>👤 {masterLinksCount}</span>
                    )}
                  </div>

                  {/* === Expanded full editor === */}
                  {isExpanded && (
                  <div className="border-t border-gold/10 p-4 pt-3">
                  {/* Form grid — name takes 2 cols on lg for visibility */}
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                    <label className="block text-[11px] uppercase tracking-wide text-muted lg:col-span-2">
                      {t("services.name")}
                      <input
                        disabled={!canManage}
                        value={nameDrafts[String(s.id)] ?? s.name_et}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNameDrafts((prev) => ({ ...prev, [String(s.id)]: v }));
                        }}
                        onBlur={(e) => {
                          const v = e.currentTarget.value;
                          setNameDrafts((prev) => {
                            const next = { ...prev };
                            delete next[String(s.id)];
                            return next;
                          });
                          if (v.trim() !== String(s.name_et || "").trim()) {
                            void saveService({ ...s, name_et: v });
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className={`${fieldBase} text-sm font-medium ${canManage ? editableUi : "border border-line/20"}`}
                      />
                    </label>
                    <div className="flex gap-2">
                      <label className="block flex-1 text-[11px] uppercase tracking-wide text-muted">
                        Цена от (€)
                        <div className="relative mt-1">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            disabled={!canManage}
                            value={s.price_cents / 100}
                            onChange={(e) => {
                              const price_cents = Math.round(Number(e.target.value) * 100);
                              setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, price_cents } : x)));
                            }}
                            onBlur={() => void saveService(s)}
                            className={`w-full rounded-lg bg-surface px-3 py-2 pr-6 text-sm text-fg disabled:opacity-60 ${canManage ? editableUi : "border border-line/20"}`}
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">€</span>
                        </div>
                      </label>
                      <label className="block flex-1 text-[11px] uppercase tracking-wide text-muted">
                        До (€)
                        <div className="relative mt-1">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            disabled={!canManage}
                            placeholder="—"
                            value={(s.price_max_cents ?? 0) > 0 ? (s.price_max_cents ?? 0) / 100 : ""}
                            onChange={(e) => {
                              const price_max_cents = e.target.value ? Math.round(Number(e.target.value) * 100) : null;
                              setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, price_max_cents } : x)));
                            }}
                            onBlur={() => void saveService(s)}
                            className={`w-full rounded-lg bg-surface px-3 py-2 pr-6 text-sm text-fg placeholder-muted disabled:opacity-60 ${canManage ? editableUi : "border border-line/20"}`}
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">€</span>
                        </div>
                      </label>
                    </div>
                    <label className="block text-[11px] uppercase tracking-wide text-muted">
                      {t("services.duration")}
                      <div className="relative mt-1">
                        <input
                          type="number"
                          min={5}
                          step={5}
                          disabled={!canManage}
                          value={s.duration_min}
                          onChange={(e) => {
                            const duration_min = Number(e.target.value);
                            setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, duration_min } : x)));
                          }}
                          onBlur={() => void saveService(s)}
                          className={`w-full rounded-lg bg-surface px-3 py-2 pr-10 text-sm text-fg disabled:opacity-60 ${canManage ? editableUi : "border border-line/20"}`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted">
                          мин
                        </span>
                      </div>
                    </label>
                    <label className="block text-[11px] uppercase tracking-wide text-muted" title="Пауза после услуги блокирует следующий слот у мастера (уборка, отдых).">
                      Пауза после
                      <div className="relative mt-1">
                        <input
                          type="number"
                          min={0}
                          step={5}
                          disabled={!canManage}
                          value={s.buffer_after_min}
                          onChange={(e) => {
                            const buffer_after_min = Number(e.target.value);
                            setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, buffer_after_min } : x)));
                          }}
                          onBlur={() => void saveService(s)}
                          className={`w-full rounded-lg bg-surface px-3 py-2 pr-10 text-sm text-fg disabled:opacity-60 ${canManage ? editableUi : "border border-line/20"}`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted">
                          мин
                        </span>
                      </div>
                    </label>
                  </div>
                  {/* Masters block */}
                  <div className="mt-3 rounded-lg border border-gold/10 bg-canvas/20 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-muted"><path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-1a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.74" /></svg>
                        Мастера
                      </p>
                      <p className="text-[10px] text-muted">
                        назначения меняются на{" "}
                        <span className="font-mono text-muted">/admin/staff</span>
                      </p>
                    </div>
                    {(() => {
                      const sid = String(s.id);
                      const links = staffLinksForService(sid);
                      const allMasters = staffListedAsMasters(staff);
                      if (allMasters.length === 0) {
                        return (
                          <p className="mt-2 text-xs text-muted">
                            Нет активных мастеров в справочнике.
                          </p>
                        );
                      }
                      /* Источник истины — staff_services. Если у услуги нет ни одной
                       * привязки, она недоступна никому: ни на сайте, ни в онлайн-
                       * записи. Раньше тут показывались все активные мастера — это
                       * вводило в заблуждение (клиент видел «делает Anna», но Anna
                       * на самом деле эту услугу не выбирала). */
                      if (links.length === 0) {
                        return (
                          <div className="mt-2 rounded-md border border-gold/20 bg-gold/[0.05] p-2.5 text-xs text-gold/60">
                            <p className="font-medium">Услугу никто не выполняет.</p>
                            <p className="mt-0.5 text-gold/50">
                              Услуга скрыта на публичном сайте и недоступна в онлайн-записи, пока хотя бы один мастер не возьмёт её. Откройте{" "}
                              <span className="font-mono text-gold/70">/admin/staff</span>, выберите мастера и включите услугу в блоке «Неактивные услуги».
                            </p>
                          </div>
                        );
                      }
                      const assignedIds = new Set(
                        links.map((l) => normId(l.staff_id)),
                      );
                      const chips = allMasters
                        .filter((m) => assignedIds.has(normId(m.id)))
                        .map((m) => {
                          const available = m.active && s.active;
                          const reason = available
                            ? "Назначен на услугу — доступен на сайте и в онлайн-записи"
                            : !s.active
                              ? "Услуга выключена (снят тумблер «Активна» выше)"
                              : "Мастер выключен в /admin/staff";
                          return {
                            id: String(m.id),
                            name: m.name || String(m.id),
                            available,
                            reason,
                          };
                        });
                      if (chips.length === 0) {
                        /* В staff_services есть строки, но ни один из этих мастеров
                         * сейчас не «mастер» (мог уволиться, потерять роль и т.п.). */
                        return (
                          <div className="mt-2 rounded-md border border-gold/20 bg-gold/[0.05] p-2.5 text-xs text-gold/60">
                            <p className="font-medium">Назначения «висят» на неактивных мастерах.</p>
                            <p className="mt-0.5 text-gold/50">
                              В staff_services есть привязки, но у этих сотрудников сейчас нет активной роли «Мастер». Откройте{" "}
                              <span className="font-mono text-gold/70">/admin/staff</span> и переназначьте услугу действующему мастеру.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {chips.map((c) => (
                            <span
                              key={c.id}
                              title={c.reason}
                              className={
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium " +
                                (c.available
                                  ? "border-gold/30 bg-gold/[0.07] text-gold/80"
                                  : "border-line/10 bg-line/[0.03] text-muted")
                              }
                            >
                              {c.name}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Bottom row: delete action right-aligned */}
                  {canManage && (
                    <div className="mt-3 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => void deleteService(s)}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted transition hover:bg-line/[0.06] hover:text-fg/60"
                        title={t("services.deletePermanent")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                      </button>
                    </div>
                  )}
                  </div>
                  )}
                </article>
                );
              })}
              {list.length === 0 && canManage && (
                <div className="rounded-lg border border-dashed border-line/20 bg-canvas/20 p-4 text-center">
                  <p className="text-sm text-muted">В этой категории пока нет услуг.</p>
                  <button
                    type="button"
                    onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                    className="mt-2 text-xs text-muted transition hover:text-fg"
                  >
                    + Добавить первую услугу
                  </button>
                </div>
              )}
            </div>
            )}
          </section>
          );
        })}
      </div>

      {quickCreateCategory !== null && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-line/15 bg-panel p-5">
            <h3 className="text-base font-semibold text-fg">Быстрое создание услуги</h3>
            <p className="mt-1 text-xs text-muted">
              Категория: {String(quickCreateCategory || "Без категории")}
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-muted">
                Название
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className={`${fieldBase} border border-line/20`}
                />
              </label>
              <label className="block text-xs text-muted">
                Цена (EUR)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={quickPriceEur}
                  onChange={(e) => setQuickPriceEur(e.target.value)}
                  className={`${fieldBase} border border-line/20`}
                />
              </label>
              <label className="block text-xs text-muted">
                Длительность (мин)
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={quickDuration}
                  onChange={(e) => setQuickDuration(e.target.value)}
                  className={`${fieldBase} border border-line/20`}
                />
              </label>
              <label className="block text-xs text-muted">
                Пауза после (мин)
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={quickBuffer}
                  onChange={(e) => setQuickBuffer(e.target.value)}
                  className={`${fieldBase} border border-line/20`}
                />
              </label>
              <div className="flex items-center gap-2 text-xs text-fg">
                <ToggleSwitch checked={quickActive} onCheckedChange={setQuickActive} aria-label="Услуга активна" />
                <span>Услуга активна</span>
              </div>
              <div className="rounded-lg border border-line/15 p-3">
                <p className="text-xs text-muted">Мастера, которые могут выполнять услугу</p>
                <p className="mt-1 text-[11px] text-muted">
                  Если не выбрать никого, услуга будет доступна всем активным мастерам.
                </p>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                  {staffListedAsMasters(staff).map((m) => {
                    const on = quickStaffIds.includes(m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs text-fg">
                        <ToggleSwitch
                          size="sm"
                          checked={on}
                          onCheckedChange={(want) => {
                            if (want !== on) toggleQuickStaff(m.id);
                          }}
                          aria-label={m.name || m.id}
                        />
                        <span>{m.name || m.id}</span>
                      </div>
                    );
                  })}
                  {staffListedAsMasters(staff).length === 0 && (
                    <p className="text-xs text-muted">Активные мастера не найдены.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeQuickCreate()}
                className="rounded-md border border-line/20 px-3 py-2 text-xs text-fg hover:bg-surface"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void createServiceFromQuickForm()}
                className="rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-fg hover:bg-sky-500"
              >
                Создать услугу
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
