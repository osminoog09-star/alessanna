import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "../lib/supabase";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useServicesCatalogRealtime } from "../hooks/useSalonRealtime";
import type { CategoryRow, ServiceRow, StaffMember } from "../types/database";
import { eurFromCents } from "../lib/format";
import { normalizeRoles } from "../lib/roles";
import { ToggleSwitch } from "../components/ToggleSwitch";

const editableUi =
  "border border-sky-600/45 ring-1 ring-sky-500/25 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40";
const fieldBase =
  "mt-1 w-full rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-60";

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
    .select("id,name,price,duration,category_id,buffer_after_min,is_active,service_categories(name)")
    .order("name", { ascending: true });

  if (res.error && String(res.error.message || "").includes("buffer_after_min")) {
    res = (await supabase
      .from("service_listings")
      .select("id,name,price,duration,category_id,is_active,service_categories(name)")
      .order("name", { ascending: true })) as typeof res;
  }
  if (res.error && String(res.error.message || "").includes("is_active")) {
    res = (await supabase
      .from("service_listings")
      .select("id,name,price,duration,category_id,service_categories(name)")
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
      active: r.is_active !== false,
      sort_order: idx,
      catalogSource: "listing",
    };
  });
}

export function ServicesPage() {
  const { t } = useTranslation();
  const { canManage } = useEffectiveRole();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
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
      const catSource = categoriesOverride ?? categories;
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

      const payload = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
        duration: Number(service.duration_min || 0),
        buffer_after_min: Number(service.buffer_after_min || 10),
        category_id: publicCategoryId,
        is_active: service.active !== false,
      };
      const payloadNoBuffer = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
        duration: Number(service.duration_min || 0),
        category_id: publicCategoryId,
        is_active: service.active !== false,
      };
      const payloadMinimal = {
        name: serviceName,
        price: Number(service.price_cents || 0) / 100,
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
  }, [categories]);

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

    const cLegacy = await supabase.from("categories").select("*").order("name");
    if (!cLegacy.error && cLegacy.data) {
      loadedCategories = cLegacy.data as CategoryRow[];
      setCategories(loadedCategories);
    } else {
      const cModern = await supabase.from("service_categories").select("id,name").order("name");
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
    load();
  }

  async function renameCategory(category: CategoryRow) {
    if (!canManage) return;
    const key = String(category.id);
    const nextName = String(categoryDrafts[key] ?? category.name).trim();
    if (!nextName || nextName === String(category.name).trim()) return;

    let updated = false;
    const legacy = await supabase.from("categories").update({ name: nextName }).eq("id", category.id);
    if (!legacy.error) {
      updated = true;
    }

    const modern = await supabase.from("service_categories").update({ name: nextName }).eq("id", category.id);
    if (!modern.error) {
      updated = true;
    }

    if (!updated) {
      console.error("[services] rename category failed", { legacy: legacy.error, modern: modern.error });
      return;
    }

    setCategoryDrafts((prev) => ({ ...prev, [key]: nextName }));
    load();
  }

  async function deleteCategory(category: CategoryRow) {
    if (!canManage) return;
    const categoryName = String(category.name || "").trim();
    const hasServices = services.some((s) => categoryNameFromService(s) === categoryName);
    if (hasServices) {
      window.alert("Сначала перенесите или удалите услуги из этой категории.");
      return;
    }
    if (!window.confirm(`Удалить категорию "${categoryName}"?`)) return;

    let removed = false;
    const legacy = await supabase.from("categories").delete().eq("id", category.id);
    if (!legacy.error) removed = true;

    const modern = await supabase.from("service_categories").delete().eq("id", category.id);
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
      const payload = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
        duration: Number(s.duration_min || 0),
        buffer_after_min: Number(s.buffer_after_min || 10),
        category_id: publicCategoryId,
        is_active: s.active !== false,
      };
      const payloadNoBuffer = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
        duration: Number(s.duration_min || 0),
        category_id: publicCategoryId,
        is_active: s.active !== false,
      };
      const payloadMinimal = {
        name: String(s.name_et || "").trim(),
        price: Number(s.price_cents || 0) / 100,
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

  async function addService() {
    if (!canManage) return;
    let insertRes = await supabase
      .from("services")
      .insert({
        name_et: i18n.t("services.newServiceDefault"),
        duration_min: 60,
        buffer_after_min: 10,
        price_cents: 3000,
        active: true,
        sort_order: services.length,
      })
      .select("*")
      .single();
    if (insertRes.error) {
      insertRes = await supabase
        .from("services")
        .insert({
          name: i18n.t("services.newServiceDefault"),
          duration: 60,
          buffer_after_min: 10,
          price: 30,
          category: null,
        })
        .select("*")
        .single();
      if (insertRes.error && String(insertRes.error.message || "").includes("buffer_after_min")) {
        insertRes = await supabase
          .from("services")
          .insert({
            name: i18n.t("services.newServiceDefault"),
            duration: 60,
            price: 30,
            category: null,
          })
          .select("*")
          .single();
      }
    }
    if (insertRes.error) {
      console.error("[services] add failed", insertRes.error);
      return;
    }
    if (insertRes.data) {
      const row = insertRes.data as Record<string, unknown>;
      const normalized =
        row.name_et != null
          ? (insertRes.data as ServiceRow)
          : mapModernServices([row])[0];
      await syncServiceToPublicCatalog(normalized);
    }
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
    const pool = q
      ? services.filter((s) => String(s.name_et || "").toLowerCase().includes(q))
      : services;

    const map = new Map<string, ServiceRow[]>();
    for (const service of pool) {
      const categoryName = categoryNameFromService(service) || "Без категории";
      if (!map.has(categoryName)) map.set(categoryName, []);
      map.get(categoryName)?.push(service);
    }
    /* Show empty category sections too when no search is active, so user can add first service directly into category. */
    if (!q) {
      for (const c of categories) {
        const name = String(c.name || "").trim();
        if (name && !map.has(name)) map.set(name, []);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ru"));
  }, [services, categories, serviceSearch]);

  /** Quick top-of-page stats: active/total services + masters coverage. */
  const servicesStats = useMemo(() => {
    const total = services.length;
    const active = services.filter((s) => s.active).length;
    const onSite = publicListingNames.size;
    return { total, active, onSite };
  }, [services, publicListingNames]);

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      {/* ───── Page header ───── */}
      <header className="rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900/60 via-zinc-950 to-black/70 p-5 shadow-sm shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sky-700/40 bg-sky-950/40 text-sky-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12m0 0 8.7-5M12 12v10" />
                </svg>
              </span>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">{t("services.title")}</h1>
                <p className="text-sm text-zinc-500">{t("services.subtitle")}</p>
              </div>
            </div>

            {/* Stat chips */}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-700/40 bg-sky-950/30 px-2.5 py-1 text-sky-200">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                Всего услуг: <strong className="font-semibold">{servicesStats.total}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-950/30 px-2.5 py-1 text-emerald-200">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Активных: <strong className="font-semibold">{servicesStats.active}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-700/40 bg-amber-950/30 px-2.5 py-1 text-amber-200">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                На главной: <strong className="font-semibold">{servicesStats.onSite}</strong>
                {publicCheckLoading && <span className="ml-1 opacity-70">(проверка…)</span>}
              </span>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshPublicStatus()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
                title="Сверить CRM со списком услуг, который видит сайт"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
                Проверить главную
              </button>
              <button
                type="button"
                onClick={() => void syncAllServicesToPublicSite()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-sm font-medium text-amber-100 transition hover:border-amber-500/80 hover:bg-amber-950/70"
                title="Записывает все активные услуги из CRM в таблицу для главного сайта (service_listings)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 3v12m-4-4 4 4 4-4M4 21h16" /></svg>
                Обновить всё на сайте
              </button>
              <button
                type="button"
                onClick={() => void addService()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-sky-500/20 transition hover:bg-sky-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                {t("services.addService")}
              </button>
            </div>
          )}
        </div>

        {/* Search — full width below header */}
        {services.length > 4 && (
          <div className="mt-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1 max-w-md">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                type="search"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Поиск по названию услуги…"
                className="w-full rounded-lg border border-zinc-700 bg-black pl-8 pr-8 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              {serviceSearch && (
                <button
                  type="button"
                  onClick={() => setServiceSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="Очистить поиск"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            {serviceSearch && (
              <span className="text-xs text-zinc-500">
                {groupedServices.reduce((n, [, list]) => n + list.length, 0)} найдено
              </span>
            )}
          </div>
        )}
      </header>

      {/* ───── Categories manager ───── */}
      {canManage && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-200">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-sky-300"><path d="M3 6h18M3 12h18M3 18h12" /></svg>
                {t("services.categories")}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Это категории услуг. В каждую категорию можно добавить услуги.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addCategory();
                  }
                }}
                placeholder={t("services.categoryPlaceholder")}
                className="w-48 rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
              />
              <button
                type="button"
                onClick={() => void addCategory()}
                disabled={!newCat.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                {t("common.add")}
              </button>
            </div>
          </div>

          {categories.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-zinc-800 bg-black/20 px-3 py-4 text-center text-xs text-zinc-500">
              Пока нет категорий. Добавьте первую — например, «Стрижка» или «Маникюр».
            </p>
          ) : (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {categories.map((c) => {
                const draft = categoryDrafts[String(c.id)];
                const changed = draft !== undefined && draft !== c.name;
                const servicesInCat = services.filter(
                  (s) => categoryNameFromService(s) === c.name,
                ).length;
                return (
                  <li
                    key={c.id}
                    className="group flex items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-black/30 px-2 py-1.5 transition hover:border-zinc-700 hover:bg-black/50"
                  >
                    <input
                      value={draft ?? c.name}
                      onChange={(e) =>
                        setCategoryDrafts((prev) => ({
                          ...prev,
                          [String(c.id)]: e.target.value,
                        }))
                      }
                      onBlur={() => {
                        if (changed) void renameCategory(c);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-zinc-100 transition hover:border-zinc-700 focus:border-sky-500 focus:bg-black focus:outline-none focus:ring-1 focus:ring-sky-500/40"
                    />
                    <span className="shrink-0 rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400" title={`Услуг в категории: ${servicesInCat}`}>
                      {servicesInCat}
                    </span>
                    {changed && (
                      <button
                        type="button"
                        onClick={() => void renameCategory(c)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-700/50 bg-sky-950/40 text-sky-300 transition hover:border-sky-500 hover:bg-sky-900/60"
                        title="Сохранить новое название"
                        aria-label="Сохранить"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="m5 13 4 4L19 7" /></svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openQuickCreate(String(c.name || "").trim())}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-emerald-950/40 hover:text-emerald-300"
                      title="Добавить услугу в эту категорию"
                      aria-label="Добавить услугу"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCategory(c)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-red-950/40 hover:text-red-300"
                      title="Удалить категорию"
                      aria-label="Удалить"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <div className="space-y-6">
        {groupedServices.map(([categoryName, list]) => {
          const activeCount = list.filter((s) => s.active).length;
          return (
          <section
            key={categoryName}
            className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/60"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 bg-gradient-to-r from-zinc-900/60 to-transparent px-5 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-emerald-400 to-sky-400 shadow-sm shadow-emerald-500/30"
                />
                <h3 className="truncate text-sm font-semibold text-zinc-100">{categoryName}</h3>
                <span className="shrink-0 rounded-full bg-zinc-800/70 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  {list.length}
                </span>
                {activeCount < list.length && (
                  <span className="shrink-0 rounded-full border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium text-amber-300" title="Часть услуг выключена">
                    {activeCount}/{list.length} активно
                  </span>
                )}
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-black/30 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-emerald-700/60 hover:bg-emerald-950/30 hover:text-emerald-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M12 5v14M5 12h14" /></svg>
                  Добавить услугу
                </button>
              )}
            </header>

            <div className="space-y-3 p-4">
              {list.map((s) => {
                const existsOnMain = publicListingNames.has(String(s.name_et || "").trim().toLowerCase());
                /* «Никто не делает» = в staff_services нет ни одной строки для услуги.
                 * Подсветим карточку жёлтым, чтобы такие услуги бросались в глаза
                 * в общем списке — иначе они теряются среди корректно настроенных. */
                const masterLinksCount = staffLinksForService(String(s.id)).length;
                const noMasters = s.active && masterLinksCount === 0;
                return (
                <article
                  key={s.id}
                  className={
                    "group relative overflow-hidden rounded-xl border bg-black/30 p-4 shadow-sm transition hover:border-zinc-700/80 " +
                    (!s.active
                      ? "border-zinc-800/60 bg-zinc-950/40 opacity-80"
                      : noMasters
                        ? "border-amber-700/60 shadow-amber-950/20"
                        : "border-zinc-800/80 shadow-black/30")
                  }
                >
                  {/* Vertical accent strip on left, colored by service state */}
                  <span
                    aria-hidden="true"
                    className={
                      "absolute inset-y-0 left-0 w-0.5 " +
                      (!s.active
                        ? "bg-zinc-700"
                        : noMasters
                          ? "bg-gradient-to-b from-amber-500 to-amber-700"
                          : "bg-gradient-to-b from-emerald-500 to-sky-500")
                    }
                  />

                  {/* Top row: status badges + active toggle */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          existsOnMain
                            ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                            : "border-amber-700/60 bg-amber-950/30 text-amber-300"
                        }`}
                        title={existsOnMain ? "Услуга видна на главной странице сайта" : "Услуга не опубликована — нажмите «Обновить всё на сайте»"}
                      >
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${existsOnMain ? "bg-emerald-400" : "bg-amber-400"}`} />
                        На главной: {existsOnMain ? "да" : "нет"}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          s.active
                            ? "border-zinc-700/80 bg-zinc-900/50 text-zinc-300"
                            : "border-zinc-700 bg-zinc-900/40 text-zinc-500"
                        }`}
                      >
                        {s.active ? "активна" : "выключена"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
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
                      <span>{t("services.active")}</span>
                    </div>
                  </div>

                  {/* Form grid — name takes 2 cols on lg for visibility */}
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                    <label className="block text-[11px] uppercase tracking-wide text-zinc-500 lg:col-span-2">
                      {t("services.name")}
                      <input
                        disabled={!canManage}
                        value={s.name_et}
                        onChange={(e) => {
                          const v = e.target.value;
                          setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, name_et: v } : x)));
                        }}
                        onBlur={() => void saveService(s)}
                        className={`${fieldBase} text-sm font-medium ${canManage ? editableUi : "border border-zinc-700"}`}
                      />
                    </label>
                    <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
                      {t("services.priceCents")}
                      <div className="relative mt-1">
                        <input
                          type="number"
                          disabled={!canManage}
                          value={s.price_cents}
                          onChange={(e) => {
                            const price_cents = Number(e.target.value);
                            setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, price_cents } : x)));
                          }}
                          onBlur={() => void saveService(s)}
                          className={`w-full rounded-lg bg-black px-3 py-2 pr-12 text-sm text-white disabled:opacity-60 ${canManage ? editableUi : "border border-zinc-700"}`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                          {eurFromCents(s.price_cents)}
                        </span>
                      </div>
                    </label>
                    <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
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
                          className={`w-full rounded-lg bg-black px-3 py-2 pr-10 text-sm text-white disabled:opacity-60 ${canManage ? editableUi : "border border-zinc-700"}`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-zinc-500">
                          мин
                        </span>
                      </div>
                    </label>
                    <label className="block text-[11px] uppercase tracking-wide text-zinc-500" title="Пауза после услуги блокирует следующий слот у мастера (уборка, отдых).">
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
                          className={`w-full rounded-lg bg-black px-3 py-2 pr-10 text-sm text-white disabled:opacity-60 ${canManage ? editableUi : "border border-zinc-700"}`}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-zinc-500">
                          мин
                        </span>
                      </div>
                    </label>
                    <label className="block text-[11px] uppercase tracking-wide text-zinc-500 md:col-span-2 lg:col-span-5">
                      {t("services.category")}
                      <select
                        disabled={!canManage}
                        value={String(s.category_id ?? s.category ?? "")}
                        onChange={(e) => {
                          const category_id = e.target.value || null;
                          const selectedCategory = categories.find((c) => String(c.id) === String(category_id));
                          const next = { ...s, category_id, category: selectedCategory?.name ?? null };
                          setServices((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                          void saveService(next);
                        }}
                        className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
                      >
                        <option value="">{t("common.dash")}</option>
                        {categories.map((c) => (
                          <option key={String(c.id)} value={String(c.id)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {/* Masters block */}
                  <div className="mt-3 rounded-lg border border-zinc-800/80 bg-black/20 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-zinc-500"><path d="M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-1a4 4 0 0 0-3-3.87M17 3.13a4 4 0 0 1 0 7.74" /></svg>
                        Мастера
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        назначения меняются на{" "}
                        <span className="font-mono text-zinc-400">/admin/staff</span>
                      </p>
                    </div>
                    {(() => {
                      const sid = String(s.id);
                      const links = staffLinksForService(sid);
                      const allMasters = staffListedAsMasters(staff);
                      if (allMasters.length === 0) {
                        return (
                          <p className="mt-2 text-xs text-zinc-500">
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
                          <div className="mt-2 rounded-md border border-amber-700/50 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                            <p className="font-medium">Услугу никто не выполняет.</p>
                            <p className="mt-0.5 text-amber-200/80">
                              Услуга скрыта на публичном сайте и недоступна в онлайн-записи, пока хотя бы один мастер не возьмёт её. Откройте{" "}
                              <span className="font-mono text-amber-100">/admin/staff</span>, выберите мастера и включите услугу в блоке «Неактивные услуги».
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
                          <div className="mt-2 rounded-md border border-amber-700/50 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                            <p className="font-medium">Назначения «висят» на неактивных мастерах.</p>
                            <p className="mt-0.5 text-amber-200/80">
                              В staff_services есть привязки, но у этих сотрудников сейчас нет активной роли «Мастер». Откройте{" "}
                              <span className="font-mono text-amber-100">/admin/staff</span> и переназначьте услугу действующему мастеру.
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
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition " +
                                (c.available
                                  ? "border-emerald-600/60 bg-emerald-900/30 text-emerald-200"
                                  : "border-zinc-700 bg-zinc-900/40 text-zinc-500")
                              }
                            >
                              <span
                                aria-hidden="true"
                                className={
                                  "h-1.5 w-1.5 rounded-full " +
                                  (c.available ? "bg-emerald-400" : "bg-zinc-600")
                                }
                              />
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
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-950/40 hover:text-red-300 focus:opacity-100"
                        title={t("services.deletePermanent")}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        {t("services.deletePermanent")}
                      </button>
                    </div>
                  )}
                </article>
                );
              })}
              {list.length === 0 && canManage && (
                <div className="rounded-lg border border-dashed border-zinc-700 bg-black/20 p-4 text-center">
                  <p className="text-sm text-zinc-400">В этой категории пока нет услуг.</p>
                  <button
                    type="button"
                    onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                    className="mt-3 inline-flex items-center gap-1 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M12 5v14M5 12h14" /></svg>
                    Добавить первую услугу
                  </button>
                </div>
              )}
            </div>
          </section>
          );
        })}
      </div>

      {quickCreateCategory !== null && canManage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="text-base font-semibold text-white">Быстрое создание услуги</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Категория: {String(quickCreateCategory || "Без категории")}
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-xs text-zinc-400">
                Название
                <input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  className={`${fieldBase} border border-zinc-700`}
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Цена (EUR)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={quickPriceEur}
                  onChange={(e) => setQuickPriceEur(e.target.value)}
                  className={`${fieldBase} border border-zinc-700`}
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Длительность (мин)
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={quickDuration}
                  onChange={(e) => setQuickDuration(e.target.value)}
                  className={`${fieldBase} border border-zinc-700`}
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Пауза после (мин)
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={quickBuffer}
                  onChange={(e) => setQuickBuffer(e.target.value)}
                  className={`${fieldBase} border border-zinc-700`}
                />
              </label>
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <ToggleSwitch checked={quickActive} onCheckedChange={setQuickActive} aria-label="Услуга активна" />
                <span>Услуга активна</span>
              </div>
              <div className="rounded-lg border border-zinc-800 p-3">
                <p className="text-xs text-zinc-400">Мастера, которые могут выполнять услугу</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Если не выбрать никого, услуга будет доступна всем активным мастерам.
                </p>
                <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                  {staffListedAsMasters(staff).map((m) => {
                    const on = quickStaffIds.includes(m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs text-zinc-300">
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
                    <p className="text-xs text-zinc-500">Активные мастера не найдены.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeQuickCreate()}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void createServiceFromQuickForm()}
                className="rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500"
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