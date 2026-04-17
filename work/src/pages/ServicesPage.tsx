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
  let res = await supabase
    .from("service_listings")
    .select("id,name,price,duration,category_id,buffer_after_min,is_active,service_categories(name)")
    .order("name", { ascending: true });

  if (res.error && String(res.error.message || "").includes("buffer_after_min")) {
    res = await supabase
      .from("service_listings")
      .select("id,name,price,duration,category_id,is_active,service_categories(name)")
      .order("name", { ascending: true });
  }
  if (res.error && String(res.error.message || "").includes("is_active")) {
    res = await supabase
      .from("service_listings")
      .select("id,name,price,duration,category_id,service_categories(name)")
      .order("name", { ascending: true });
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
          sModern = await supabase
            .from("services")
            .select("id,name,category,duration,price,created_at")
            .order("name", { ascending: true });
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
          roles: [],
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

  async function addServiceToCategory(categoryName: string) {
    if (!canManage) return;
    const found = categories.find((c) => String(c.name || "").trim() === categoryName);
    const categoryId = found ? String(found.id) : null;

    let insertRes = await supabase
      .from("services")
      .insert({
        name_et: i18n.t("services.newServiceDefault"),
        duration_min: 60,
        buffer_after_min: 10,
        price_cents: 3000,
        active: true,
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
          name: i18n.t("services.newServiceDefault"),
          duration: 60,
          buffer_after_min: 10,
          price: 30,
          category: categoryName || null,
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
            category: categoryName || null,
          })
          .select("*")
          .single();
      }
    }

    if (insertRes.error) {
      console.error("[services] add service in category failed", insertRes.error);
      return;
    }

    if (insertRes.data) {
      const row = insertRes.data as Record<string, unknown>;
      const normalized = row.name_et != null ? (insertRes.data as ServiceRow) : mapModernServices([row])[0];
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

  async function setStaffLinksForServiceAndReload(
    service: ServiceRow,
    next: Array<{ staff_id: string; show_on_site: boolean }>,
  ) {
    const ok = await replaceServiceStaffLinks(service, next);
    if (ok) await load();
  }

  function toggleStaffPerforms(service: ServiceRow, staffId: string, checked: boolean) {
    if (!canManage) return;
    const serviceId = String(service.id);
    const prev = staffLinksForService(serviceId);
    const activeIds = staffListedAsMasters(staff).map((m) => String(m.id));
    const sid = String(staffId);
    let next: Array<{ staff_id: string; show_on_site: boolean }>;

    if (prev.length === 0) {
      if (checked) {
        next = [{ staff_id: sid, show_on_site: true }];
      } else {
        next = activeIds.filter((id) => id !== sid).map((id) => ({ staff_id: id, show_on_site: true }));
      }
    } else if (checked) {
      const byId = new Map<string, { staff_id: string; show_on_site: boolean }>(
        prev.map((l) => [normId(l.staff_id), { ...l, staff_id: String(l.staff_id) }]),
      );
      if (!byId.has(normId(sid))) byId.set(normId(sid), { staff_id: sid, show_on_site: true });
      next = Array.from(byId.values());
    } else {
      next = prev.filter((l) => normId(l.staff_id) !== normId(sid));
    }

    void setStaffLinksForServiceAndReload(service, next);
  }

  async function toggleStaffOnSite(service: ServiceRow, staffId: string, visible: boolean) {
    if (!canManage) return;
    const serviceId = String(service.id);
    let prev = staffLinksForService(serviceId);
    /* Пустой staff_services = «все мастера»; без строк в БД нельзя менять show_on_site по мастеру — сначала материализуем привязки. */
    if (!prev.length) {
      const rows = staffListedAsMasters(staff).map((m) => ({
        staff_id: String(m.id),
        show_on_site: true,
      }));
      const ok = await replaceServiceStaffLinks(service, rows);
      if (!ok) return;
      await load();
      prev = staffLinksForService(serviceId);
      if (!prev.length) return;
    }
    const next = prev.map((l) =>
      normId(l.staff_id) === normId(staffId) ? { ...l, show_on_site: visible } : l,
    );
    await setStaffLinksForServiceAndReload(service, next);
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
    const map = new Map<string, ServiceRow[]>();
    for (const service of services) {
      const categoryName = categoryNameFromService(service) || "Без категории";
      if (!map.has(categoryName)) map.set(categoryName, []);
      map.get(categoryName)?.push(service);
    }
    // Show empty category sections too, so user can add first service directly into category.
    for (const c of categories) {
      const name = String(c.name || "").trim();
      if (name && !map.has(name)) map.set(name, []);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ru"));
  }, [services, categories]);

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("services.title")}</h1>
          <p className="text-sm text-zinc-500">{t("services.subtitle")}</p>
          <p className="mt-1 text-xs text-zinc-500">
            На главной сейчас видно услуг: {publicListingNames.size}
            {publicCheckLoading ? " (проверка...)" : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshPublicStatus()}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-900"
            >
              Проверить главную
            </button>
            <button
              type="button"
              onClick={() => void syncAllServicesToPublicSite()}
              className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-950/70"
              title="Записывает все активные услуги из CRM в таблицу для главного сайта (service_listings)"
            >
              Обновить всё на сайте
            </button>
            <button
              type="button"
              onClick={() => void addService()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
            >
              {t("services.addService")}
            </button>
          </div>
        )}
      </header>

      {canManage && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h2 className="text-sm font-semibold text-white">{t("services.categories")}</h2>
          <p className="mt-1 text-xs text-zinc-500">Это категории услуг. В каждую категорию можно добавить услуги.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder={t("services.categoryPlaceholder")}
              className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              onClick={() => void addCategory()}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
            >
              {t("common.add")}
            </button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm text-zinc-400">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2">
                <input
                  value={categoryDrafts[String(c.id)] ?? c.name}
                  onChange={(e) =>
                    setCategoryDrafts((prev) => ({
                      ...prev,
                      [String(c.id)]: e.target.value,
                    }))
                  }
                  onBlur={() => void renameCategory(c)}
                  className="w-44 rounded border border-zinc-700 bg-black px-2 py-1 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={() => void renameCategory(c)}
                  className="text-xs text-sky-400 hover:text-sky-300"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  onClick={() => openQuickCreate(String(c.name || "").trim())}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  + Услуга
                </button>
                <button
                  type="button"
                  onClick={() => void deleteCategory(c)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-6">
        {groupedServices.map(([categoryName, list]) => (
          <section key={categoryName} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-200">{categoryName}</h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                  className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                >
                  + Добавить услугу в категорию
                </button>
              )}
            </div>

            <div className="space-y-4">
              {list.map((s) => (
                <div
                  key={s.id}
                  className="grid gap-4 rounded-xl border border-zinc-800 bg-black/30 p-4 md:grid-cols-2 lg:grid-cols-5"
                >
                  <div className="lg:col-span-5">
                    {(() => {
                      const existsOnMain = publicListingNames.has(String(s.name_et || "").trim().toLowerCase());
                      return (
                        <span
                          className={`inline-flex rounded-md px-2 py-1 text-xs ${
                            existsOnMain
                              ? "border border-emerald-700/60 text-emerald-300"
                              : "border border-amber-700/60 text-amber-300"
                          }`}
                        >
                          На главной: {existsOnMain ? "отображается" : "не отображается"}
                        </span>
                      );
                    })()}
                  </div>
                  <label className="block text-xs text-zinc-500">
                    {t("services.name")}
                    <input
                      disabled={!canManage}
                      value={s.name_et}
                      onChange={(e) => {
                        const v = e.target.value;
                        setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, name_et: v } : x)));
                      }}
                      onBlur={() => void saveService(s)}
                      className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
                    />
                  </label>
                  <label className="block text-xs text-zinc-500">
                    {t("services.priceCents")}
                    <input
                      type="number"
                      disabled={!canManage}
                      value={s.price_cents}
                      onChange={(e) => {
                        const price_cents = Number(e.target.value);
                        setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, price_cents } : x)));
                      }}
                      onBlur={() => void saveService(s)}
                      className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
                    />
                    <span className="mt-1 block text-zinc-600">{eurFromCents(s.price_cents)}</span>
                  </label>
                  <label className="block text-xs text-zinc-500">
                    {t("services.duration")}
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
                      className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
                    />
                    <span className="mt-1 block text-zinc-600">Минуты работы</span>
                  </label>
                  <label className="block text-xs text-zinc-500">
                    Пауза после (мин)
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
                      className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
                    />
                    <span className="mt-1 block text-zinc-600">Тоже блокирует слот</span>
                  </label>
                  <label className="block text-xs text-zinc-500">
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
                  <div className="rounded-lg border border-zinc-800 bg-black/20 p-3 lg:col-span-5">
                    <p className="text-xs text-zinc-400">Мастера</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Без отметок — услугу могут все активные мастера, на сайте тоже все. Отметьте мастеров, чтобы
                      ограничить, кто выполняет услугу; «На сайте» скрывает мастера только с главной и онлайн-записи (в
                      CRM остаётся).
                    </p>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                      {staffListedAsMasters(staff).map((m) => {
                          const sid = String(s.id);
                          const prev = staffLinksForService(sid);
                          const link = prev.find((l) => normId(l.staff_id) === normId(m.id));
                          /* Пустой staff_services = все активные мастера могут услугу — показываем включено */
                          const performs = prev.length === 0 || !!link;
                          const onSite = link ? link.show_on_site !== false : true;
                          return (
                            <div
                              key={m.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-zinc-800/80 px-2 py-2"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-zinc-300">
                                <ToggleSwitch
                                  size="sm"
                                  disabled={!canManage}
                                  checked={performs}
                                  onCheckedChange={(v) => toggleStaffPerforms(s, m.id, v)}
                                  aria-label={`${m.name}: выполняет услугу`}
                                />
                                <span className="truncate font-medium">{m.name || m.id}</span>
                              </div>
                              <div
                                className={`flex items-center gap-2 text-[11px] ${link ? "text-zinc-400" : "text-zinc-600"}`}
                                title={!link ? "Сначала включите «выполняет услугу»" : undefined}
                              >
                                <span className="whitespace-nowrap">На сайте</span>
                                <ToggleSwitch
                                  size="sm"
                                  disabled={!canManage || (prev.length > 0 && !link)}
                                  checked={onSite}
                                  onCheckedChange={(v) => void toggleStaffOnSite(s, m.id, v)}
                                  aria-label={`${m.name}: на сайте`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      {staffListedAsMasters(staff).length === 0 && (
                        <p className="text-xs text-zinc-500">Нет активных мастеров в справочнике.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 lg:col-span-5">
                    <div className="flex items-center gap-3 text-sm text-zinc-400">
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
                      <span className="text-xs text-zinc-600">
                        {s.active ? "включена в CRM" : "выключена"}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div className="lg:col-span-5">
                      <button
                        type="button"
                        onClick={() => void deleteService(s)}
                        className="text-xs font-medium text-red-400 hover:text-red-300"
                      >
                        {t("services.deletePermanent")}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {list.length === 0 && canManage && (
                <div className="rounded-lg border border-dashed border-zinc-700 bg-black/20 p-4">
                  <p className="text-sm text-zinc-400">В этой категории пока нет услуг.</p>
                  <button
                    type="button"
                    onClick={() => openQuickCreate(categoryName === "Без категории" ? "" : categoryName)}
                    className="mt-3 rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    + Добавить первую услугу
                  </button>
                </div>
              )}
            </div>
          </section>
        ))}
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