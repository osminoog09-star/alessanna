import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "../lib/supabase";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useServicesCatalogRealtime } from "../hooks/useSalonRealtime";
import type { CategoryRow, ServiceRow } from "../types/database";
import { eurFromCents } from "../lib/format";

const editableUi =
  "border border-sky-600/45 ring-1 ring-sky-500/25 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40";
const fieldBase =
  "mt-1 w-full rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-60";

export function ServicesPage() {
  const { t } = useTranslation();
  const { canManage } = useEffectiveRole();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");

  function categoryNameFromService(service: ServiceRow): string {
    const direct = String(service.category || "").trim();
    if (direct) return direct;
    const byId = categories.find((c) => String(c.id) === String(service.category_id || ""));
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

  const syncServiceToPublicCatalog = useCallback(async (service: ServiceRow) => {
    const serviceName = String(service.name_et || "").trim();
    if (!serviceName) return;

    try {
      let categoryName = categoryNameFromService(service);
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
    const cLegacy = await supabase.from("categories").select("*").order("name");
    if (!cLegacy.error && cLegacy.data) {
      setCategories(cLegacy.data as CategoryRow[]);
    } else {
      const cModern = await supabase.from("service_categories").select("id,name").order("name");
      if (cModern.data) {
        setCategories(
          (cModern.data as Array<{ id: string; name: string }>).map((r) => ({
            id: String(r.id) as unknown as number,
            name: String(r.name || ""),
          }))
        );
      }
    }

    const sLegacy = await supabase.from("services").select("*").order("sort_order", { ascending: true });
    if (!sLegacy.error && sLegacy.data) {
      setServices(sLegacy.data as ServiceRow[]);
    } else {
      const sModern = await supabase
        .from("services")
        .select("id,name,category,duration,buffer_after_min,price,created_at")
        .order("name", { ascending: true });
      if (sModern.data) setServices(mapModernServices(sModern.data as Array<Record<string, unknown>>));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function saveService(s: ServiceRow) {
    if (!canManage) return;
    const categoryName = categoryNameFromService(s) || null;
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
      .eq("id", s.id);
    if (legacy.error) {
      const modern = await supabase
        .from("services")
        .update({
          name: s.name_et,
          duration: s.duration_min,
          buffer_after_min: s.buffer_after_min,
          price: Number(s.price_cents || 0) / 100,
          category: categoryName,
        })
        .eq("id", s.id);
      if (modern.error) {
        console.error("[services] save failed", modern.error);
        return;
      }
    }
    await syncServiceToPublicCatalog(s);
    load();
  }

  async function deleteService(s: ServiceRow) {
    if (!canManage) return;
    if (!window.confirm(t("services.deleteConfirm", { name: s.name_et }))) return;
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
    load();
  }

  if (loading) return <p className="text-zinc-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("services.title")}</h1>
          <p className="text-sm text-zinc-500">{t("services.subtitle")}</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => void addService()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            {t("services.addService")}
          </button>
        )}
      </header>

      {canManage && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h2 className="text-sm font-semibold text-white">{t("services.categories")}</h2>
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
              <li key={c.id} className="rounded-full border border-zinc-800 px-3 py-1">
                {c.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-4">
        {services.map((s) => (
          <div
            key={s.id}
            className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5 md:grid-cols-2 lg:grid-cols-4"
          >
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
                disabled={!canManage}
                value={s.duration_min}
                onChange={(e) => {
                  const duration_min = Number(e.target.value);
                  setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, duration_min } : x)));
                }}
                onBlur={() => void saveService(s)}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              />
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
            <label className="flex items-center gap-2 text-sm text-zinc-400 lg:col-span-4">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={s.active}
                onChange={(e) => {
                  const active = e.target.checked;
                  setServices((prev) => prev.map((x) => (x.id === s.id ? { ...x, active } : x)));
                  void saveService({ ...s, active });
                }}
              />
              {t("services.active")}
            </label>
            {canManage && (
              <div className="lg:col-span-4">
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
      </div>
    </div>
  );
}