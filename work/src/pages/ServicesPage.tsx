import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { supabase } from "../lib/supabase";
import { useEffectiveRole } from "../context/EffectiveRoleContext";
import { useServicesCatalogRealtime } from "../hooks/useSalonRealtime";
import type { ServiceCategoryRow, ServiceListingRow } from "../types/database";
import { eurFromEuroAmount } from "../lib/format";

const editableUi =
  "border border-sky-600/45 ring-1 ring-sky-500/25 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40";
const fieldBase =
  "mt-1 w-full rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-60";

export function ServicesPage() {
  const { t } = useTranslation();
  const { canManage } = useEffectiveRole();
  const [categories, setCategories] = useState<ServiceCategoryRow[]>([]);
  const [listings, setListings] = useState<ServiceListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCat, setNewCat] = useState("");

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      supabase.from("service_categories").select("*").order("sort_order", { ascending: true }).order("name"),
      supabase.from("service_listings").select("*").order("sort_order", { ascending: true }),
    ]);
    if (c.data) setCategories(c.data as ServiceCategoryRow[]);
    if (s.data) setListings(s.data as ServiceListingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useServicesCatalogRealtime(load);

  async function addCategory() {
    if (!newCat.trim() || !canManage) return;
    await supabase.from("service_categories").insert({
      name: newCat.trim(),
      sort_order: categories.length,
    });
    setNewCat("");
    void load();
  }

  async function saveListing(row: ServiceListingRow) {
    if (!canManage) return;
    await supabase
      .from("service_listings")
      .update({
        name: row.name,
        price: row.price,
        duration: row.duration,
        buffer_after_min: row.buffer_after_min,
        is_active: row.is_active,
        category_id: row.category_id,
        sort_order: row.sort_order,
      })
      .eq("id", row.id);
    void load();
  }

  async function deleteListing(row: ServiceListingRow) {
    if (!canManage) return;
    if (!window.confirm(t("services.deleteConfirm", { name: row.name }))) return;
    const { count, error: cErr } = await supabase
      .from("appointment_services")
      .select("id", { count: "exact", head: true })
      .eq("service_id", row.id);
    if (cErr) return;
    if ((count ?? 0) > 0) {
      window.alert(t("services.deleteBlockedBookings"));
      return;
    }
    await supabase.from("staff_services").delete().eq("service_id", row.id);
    const { error } = await supabase.from("service_listings").delete().eq("id", row.id);
    if (error) {
      window.alert(t("services.deleteFailed"));
      return;
    }
    void load();
  }

  async function addListing() {
    if (!canManage) return;
    await supabase.from("service_listings").insert({
      name: i18n.t("services.newServiceDefault"),
      duration: 60,
      buffer_after_min: 10,
      price: 30,
      is_active: true,
      sort_order: listings.length,
    });
    void load();
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
            onClick={() => void addListing()}
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
        {listings.map((row) => (
          <div
            key={row.id}
            className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5 md:grid-cols-2 lg:grid-cols-4"
          >
            <label className="block text-xs text-zinc-500">
              {t("services.name")}
              <input
                disabled={!canManage}
                value={row.name}
                onChange={(e) => {
                  const v = e.target.value;
                  setListings((prev) => prev.map((x) => (x.id === row.id ? { ...x, name: v } : x)));
                }}
                onBlur={() => void saveListing(row)}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              {t("services.priceCents")}
              <input
                type="number"
                step="0.01"
                disabled={!canManage}
                value={row.price ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setListings((prev) => prev.map((x) => (x.id === row.id ? { ...x, price: v } : x)));
                }}
                onBlur={() => void saveListing(row)}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              />
              <span className="mt-1 block text-zinc-600">{eurFromEuroAmount(Number(row.price ?? 0))}</span>
            </label>
            <label className="block text-xs text-zinc-500">
              {t("services.duration")}
              <input
                type="number"
                disabled={!canManage}
                value={row.duration ?? ""}
                onChange={(e) => {
                  const duration = e.target.value === "" ? null : Number(e.target.value);
                  setListings((prev) => prev.map((x) => (x.id === row.id ? { ...x, duration } : x)));
                }}
                onBlur={() => void saveListing(row)}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              Buffer (min)
              <input
                type="number"
                disabled={!canManage}
                value={row.buffer_after_min}
                onChange={(e) => {
                  const buffer_after_min = Number(e.target.value);
                  setListings((prev) => prev.map((x) => (x.id === row.id ? { ...x, buffer_after_min } : x)));
                }}
                onBlur={() => void saveListing(row)}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              />
            </label>
            <label className="block text-xs text-zinc-500">
              {t("services.category")}
              <select
                disabled={!canManage}
                value={row.category_id ?? ""}
                onChange={(e) => {
                  const category_id = e.target.value || null;
                  const next = { ...row, category_id };
                  setListings((prev) => prev.map((x) => (x.id === row.id ? next : x)));
                  void saveListing(next);
                }}
                className={`${fieldBase} ${canManage ? editableUi : "border border-zinc-700"}`}
              >
                <option value="">{t("common.dash")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-400 lg:col-span-4">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={row.is_active}
                onChange={(e) => {
                  const is_active = e.target.checked;
                  setListings((prev) => prev.map((x) => (x.id === row.id ? { ...x, is_active } : x)));
                  void saveListing({ ...row, is_active });
                }}
              />
              {t("services.active")}
            </label>
            {canManage && (
              <div className="lg:col-span-4">
                <button
                  type="button"
                  onClick={() => void deleteListing(row)}
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
