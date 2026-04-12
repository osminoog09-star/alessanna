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

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("services").select("*").order("sort_order", { ascending: true }),
    ]);
    if (c.data) setCategories(c.data as CategoryRow[]);
    if (s.data) setServices(s.data as ServiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useServicesCatalogRealtime(load);

  async function addCategory() {
    if (!newCat.trim() || !canManage) return;
    await supabase.from("categories").insert({ name: newCat.trim() });
    setNewCat("");
    load();
  }

  async function saveService(s: ServiceRow) {
    if (!canManage) return;
    await supabase
      .from("services")
      .update({
        name_et: s.name_et,
        duration_min: s.duration_min,
        price_cents: s.price_cents,
        active: s.active,
        category_id: s.category_id,
      })
      .eq("id", s.id);
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
    load();
  }

  async function addService() {
    if (!canManage) return;
    await supabase.from("services").insert({
      name_et: i18n.t("services.newServiceDefault"),
      duration_min: 60,
      buffer_after_min: 10,
      price_cents: 3000,
      active: true,
      sort_order: services.length,
    });
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
                value={s.category_id ?? ""}
                onChange={(e) => {
                  const category_id = e.target.value ? Number(e.target.value) : null;
                  const next = { ...s, category_id };
                  setServices((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                  void saveService(next);
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
