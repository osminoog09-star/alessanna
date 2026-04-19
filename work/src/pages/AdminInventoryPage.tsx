import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { loadServicesCatalog } from "../lib/loadServicesCatalog";
import type { ServiceRow } from "../types/database";

type InventoryItem = {
  id: string;
  name: string;
  unit: string;
  on_hand: number;
  low_stock_threshold: number | null;
  category: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
};

type Movement = {
  id: string;
  inventory_item_id: string;
  movement_type: "purchase" | "consumption" | "adjustment_in" | "adjustment_out" | "manual_consumption";
  delta: number;
  on_hand_after: number;
  appointment_id: string | null;
  notes: string | null;
  cost_cents: number | null;
  created_at: string;
};

type Norm = {
  id: string;
  service_listing_id: string;
  inventory_item_id: string;
  amount: number;
  notes: string | null;
};

type Tab = "items" | "norms" | "movements";

const UNITS = ["pcs", "ml", "g", "box", "pair"] as const;

export function AdminInventoryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("items");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [norms, setNorms] = useState<Norm[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [itemsRes, normsRes, mvRes, svc] = await Promise.all([
      supabase.from("inventory_items").select("*").order("name"),
      supabase.from("inventory_consumption_norms").select("*"),
      supabase
        .from("inventory_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      loadServicesCatalog({ activeOnly: true }),
    ]);
    setLoading(false);
    if (itemsRes.error) {
      setErr(itemsRes.error.message);
      return;
    }
    if (normsRes.error) {
      setErr(normsRes.error.message);
      return;
    }
    if (mvRes.error) {
      setErr(mvRes.error.message);
      return;
    }
    setItems((itemsRes.data ?? []) as InventoryItem[]);
    setNorms((normsRes.data ?? []) as Norm[]);
    setMovements((mvRes.data ?? []) as Movement[]);
    setServices(svc);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const lowStock = useMemo(
    () =>
      items.filter(
        (i) => i.is_active && i.low_stock_threshold != null && i.on_hand <= i.low_stock_threshold
      ),
    [items]
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {t("inventory.title", { defaultValue: "Склад / расходники" })}
          </h1>
          <p className="text-sm text-zinc-500">
            {t("inventory.subtitle", {
              defaultValue:
                "Учёт расходных материалов, нормы расхода на услуги, журнал движений.",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900"
        >
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </header>

      {lowStock.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-sm text-amber-100">
          <p className="font-semibold">
            {t("inventory.lowStockAlert", {
              defaultValue: "Заканчивается ({{count}})",
              count: lowStock.length,
            })}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {lowStock.map((i) => (
              <li key={i.id}>
                {i.name} — {i.on_hand} {i.unit}{" "}
                <span className="text-amber-300/70">
                  ≤ {i.low_stock_threshold} {i.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="flex gap-1 border-b border-zinc-800">
        {(["items", "norms", "movements"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === k
                ? "border-sky-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(`inventory.tab.${k}`, {
              defaultValue: { items: "Материалы", norms: "Нормы", movements: "Движения" }[k],
            })}
          </button>
        ))}
      </nav>

      {err && <p className="rounded border border-red-900 bg-red-950/40 p-2 text-sm text-red-300">{err}</p>}
      {loading && <p className="text-sm text-zinc-500">{t("common.loading")}</p>}

      {!loading && tab === "items" && (
        <ItemsTab items={items} onChanged={reload} />
      )}
      {!loading && tab === "norms" && (
        <NormsTab items={items} services={services} norms={norms} onChanged={reload} />
      )}
      {!loading && tab === "movements" && (
        <MovementsTab items={items} movements={movements} onChanged={reload} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ItemsTab({ items, onChanged }: { items: InventoryItem[]; onChanged: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Partial<InventoryItem> | null>(null);
  const [pending, setPending] = useState(false);

  function startCreate() {
    setEditing({ name: "", unit: "pcs", on_hand: 0, low_stock_threshold: null, is_active: true });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || !editing.name) return;
    setPending(true);
    const payload = {
      name: editing.name.trim(),
      unit: editing.unit || "pcs",
      low_stock_threshold:
        editing.low_stock_threshold != null && Number.isFinite(Number(editing.low_stock_threshold))
          ? Number(editing.low_stock_threshold)
          : null,
      category: editing.category?.trim() || null,
      notes: editing.notes?.trim() || null,
      is_active: editing.is_active ?? true,
    };
    const res = editing.id
      ? await supabase.from("inventory_items").update(payload).eq("id", editing.id)
      : await supabase.from("inventory_items").insert({ ...payload, on_hand: editing.on_hand ?? 0 });
    setPending(false);
    if (res.error) {
      alert(res.error.message);
      return;
    }
    setEditing(null);
    await onChanged();
  }

  async function toggleActive(it: InventoryItem) {
    const { error } = await supabase
      .from("inventory_items")
      .update({ is_active: !it.is_active })
      .eq("id", it.id);
    if (error) alert(error.message);
    else await onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={startCreate}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          + {t("inventory.addItem", { defaultValue: "Добавить материал" })}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">{t("inventory.col.name", { defaultValue: "Название" })}</th>
              <th className="px-3 py-2">{t("inventory.col.unit", { defaultValue: "Ед." })}</th>
              <th className="px-3 py-2 text-right">{t("inventory.col.onHand", { defaultValue: "Остаток" })}</th>
              <th className="px-3 py-2 text-right">{t("inventory.col.threshold", { defaultValue: "Порог" })}</th>
              <th className="px-3 py-2">{t("inventory.col.category", { defaultValue: "Категория" })}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {t("inventory.empty", { defaultValue: "Материалов пока нет" })}
                </td>
              </tr>
            )}
            {items.map((i) => {
              const low =
                i.is_active && i.low_stock_threshold != null && i.on_hand <= i.low_stock_threshold;
              return (
                <tr key={i.id} className={i.is_active ? "" : "opacity-50"}>
                  <td className="px-3 py-2 text-white">{i.name}</td>
                  <td className="px-3 py-2 text-zinc-400">{i.unit}</td>
                  <td className={`px-3 py-2 text-right ${low ? "text-amber-300" : "text-zinc-200"}`}>
                    {i.on_hand}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-500">
                    {i.low_stock_threshold ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">{i.category ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(i)}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      {t("common.edit", { defaultValue: "Изменить" })}
                    </button>
                    <span className="px-1 text-zinc-700">·</span>
                    <button
                      type="button"
                      onClick={() => void toggleActive(i)}
                      className="text-xs text-zinc-400 hover:underline"
                    >
                      {i.is_active
                        ? t("common.archive", { defaultValue: "В архив" })
                        : t("common.unarchive", { defaultValue: "Из архива" })}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? t("inventory.editItem", { defaultValue: "Редактировать материал" }) : t("inventory.addItem", { defaultValue: "Добавить материал" })} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="space-y-3">
            <Field label={t("inventory.col.name", { defaultValue: "Название" })} required>
              <input
                type="text"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("inventory.col.unit", { defaultValue: "Единица" })}>
                <select
                  value={editing.unit ?? "pcs"}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("inventory.col.threshold", { defaultValue: "Low-stock порог" })}>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={editing.low_stock_threshold ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      low_stock_threshold: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                />
              </Field>
            </div>
            <Field label={t("inventory.col.category", { defaultValue: "Категория" })}>
              <input
                type="text"
                value={editing.category ?? ""}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                placeholder={t("inventory.categoryPlaceholder", { defaultValue: "лак / база / расходка" })}
              />
            </Field>
            <Field label={t("inventory.col.notes", { defaultValue: "Заметки" })}>
              <textarea
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </Field>
            {!editing.id && (
              <Field label={t("inventory.startingBalance", { defaultValue: "Начальный остаток" })}>
                <input
                  type="number"
                  step="0.001"
                  min={0}
                  value={editing.on_hand ?? 0}
                  onChange={(e) => setEditing({ ...editing, on_hand: Number(e.target.value) })}
                  className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  {t("inventory.startingBalanceHint", {
                    defaultValue: "После создания корректировки идут только через журнал движений.",
                  })}
                </p>
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {pending ? t("common.saving", { defaultValue: "Сохраняем…" }) : t("common.save", { defaultValue: "Сохранить" })}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NormsTab({
  items,
  services,
  norms,
  onChanged,
}: {
  items: InventoryItem[];
  services: ServiceRow[];
  norms: Norm[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [serviceId, setServiceId] = useState<string>("");
  const [editing, setEditing] = useState<{ inventory_item_id: string; amount: number } | null>(null);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const normsForService = useMemo(
    () => norms.filter((n) => n.service_listing_id === serviceId),
    [norms, serviceId]
  );

  // Нормы привязаны FK к service_listings, поэтому показываем только записи
  // с catalogSource === "listing" (или те, у которых id уже uuid-строка).
  const activeServices = useMemo(
    () =>
      services.filter(
        (s) => s.active !== false && (s.catalogSource === "listing" || typeof s.id === "string")
      ),
    [services]
  );

  async function addNorm(e: FormEvent) {
    e.preventDefault();
    if (!serviceId || !editing || editing.amount <= 0) return;
    const { error } = await supabase
      .from("inventory_consumption_norms")
      .upsert(
        {
          service_listing_id: serviceId,
          inventory_item_id: editing.inventory_item_id,
          amount: editing.amount,
        },
        { onConflict: "service_listing_id,inventory_item_id" }
      );
    if (error) {
      alert(error.message);
      return;
    }
    setEditing(null);
    await onChanged();
  }

  async function removeNorm(id: string) {
    if (!window.confirm(t("inventory.removeNormConfirm", { defaultValue: "Удалить норму расхода?" }))) return;
    const { error } = await supabase.from("inventory_consumption_norms").delete().eq("id", id);
    if (error) alert(error.message);
    else await onChanged();
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-zinc-500">
          {t("inventory.selectService", { defaultValue: "Выберите услугу" })}
        </label>
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setEditing(null);
          }}
          className="mt-1 w-full max-w-md rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
        >
          <option value="">— {t("common.choose", { defaultValue: "выбрать" })} —</option>
          {activeServices.map((s) => (
            <option key={String(s.id)} value={String(s.id)}>
              {s.name_et || String(s.id)}
            </option>
          ))}
        </select>
      </div>

      {serviceId && (
        <div className="space-y-3 rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {t("inventory.normsForService", { defaultValue: "Нормы расхода для услуги" })}
            </h3>
            <button
              type="button"
              onClick={() =>
                setEditing({
                  inventory_item_id: items.find((i) => i.is_active)?.id ?? "",
                  amount: 1,
                })
              }
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              + {t("inventory.addNorm", { defaultValue: "Добавить норму" })}
            </button>
          </div>

          {normsForService.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {t("inventory.noNorms", { defaultValue: "Норм пока нет" })}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {normsForService.map((n) => {
                const it = itemMap.get(n.inventory_item_id);
                return (
                  <li key={n.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-white">{it?.name ?? n.inventory_item_id}</span>
                    <span className="text-zinc-400">
                      {n.amount} {it?.unit ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeNorm(n.id)}
                      className="text-xs text-red-400 hover:underline"
                    >
                      {t("common.delete", { defaultValue: "Удалить" })}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {editing && (
            <form
              onSubmit={addNorm}
              className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 sm:grid-cols-3"
            >
              <select
                value={editing.inventory_item_id}
                onChange={(e) => setEditing({ ...editing, inventory_item_id: e.target.value })}
                className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                {items
                  .filter((i) => i.is_active)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
              </select>
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={editing.amount}
                onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                placeholder={t("inventory.amountPerService", { defaultValue: "Расход на 1 услугу" })}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white"
                >
                  {t("common.save", { defaultValue: "Сохранить" })}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MovementsTab({
  items,
  movements,
  onChanged,
}: {
  items: InventoryItem[];
  movements: Movement[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{
    inventory_item_id: string;
    movement_type: Movement["movement_type"];
    delta: number;
    notes: string;
    cost_cents: string;
  }>({
    inventory_item_id: "",
    movement_type: "purchase",
    delta: 1,
    notes: "",
    cost_cents: "",
  });

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.inventory_item_id || !form.delta) return;

    // Знак delta зависит от типа движения. Фронт принимает положительное число
    // от пользователя и нормализует знак.
    const isOut =
      form.movement_type === "consumption" ||
      form.movement_type === "adjustment_out" ||
      form.movement_type === "manual_consumption";
    const signedDelta = isOut ? -Math.abs(form.delta) : Math.abs(form.delta);

    const payload = {
      inventory_item_id: form.inventory_item_id,
      movement_type: form.movement_type,
      delta: signedDelta,
      on_hand_after: 0, // триггер пересчитает
      notes: form.notes.trim() || null,
      cost_cents:
        form.movement_type === "purchase" && form.cost_cents.trim() !== ""
          ? Math.round(Number(form.cost_cents) * 100)
          : null,
    };
    const { error } = await supabase.from("inventory_movements").insert(payload);
    if (error) {
      alert(error.message);
      return;
    }
    setAdding(false);
    setForm({ ...form, delta: 1, notes: "", cost_cents: "" });
    await onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          + {t("inventory.addMovement", { defaultValue: "Добавить движение" })}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-400">
            <tr>
              <th className="px-3 py-2">{t("inventory.col.date", { defaultValue: "Когда" })}</th>
              <th className="px-3 py-2">{t("inventory.col.item", { defaultValue: "Материал" })}</th>
              <th className="px-3 py-2">{t("inventory.col.type", { defaultValue: "Тип" })}</th>
              <th className="px-3 py-2 text-right">{t("inventory.col.delta", { defaultValue: "Δ" })}</th>
              <th className="px-3 py-2 text-right">{t("inventory.col.balance", { defaultValue: "Остаток" })}</th>
              <th className="px-3 py-2">{t("inventory.col.notes", { defaultValue: "Комментарий" })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {movements.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {t("inventory.noMovements", { defaultValue: "Движений пока нет" })}
                </td>
              </tr>
            )}
            {movements.map((m) => {
              const it = itemMap.get(m.inventory_item_id);
              const positive = m.delta > 0;
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-zinc-400">{new Date(m.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-white">{it?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {t(`inventory.type.${m.movement_type}`, {
                      defaultValue: m.movement_type,
                    })}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${positive ? "text-emerald-300" : "text-red-300"}`}>
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-200">{m.on_hand_after}</td>
                  <td className="px-3 py-2 text-zinc-500">{m.notes ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title={t("inventory.addMovement", { defaultValue: "Добавить движение" })} onClose={() => setAdding(false)}>
          <form onSubmit={submit} className="space-y-3">
            <Field label={t("inventory.col.item", { defaultValue: "Материал" })} required>
              <select
                value={form.inventory_item_id}
                onChange={(e) => setForm({ ...form, inventory_item_id: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                required
              >
                <option value="">— {t("common.choose", { defaultValue: "выбрать" })} —</option>
                {items
                  .filter((i) => i.is_active)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("inventory.col.type", { defaultValue: "Тип движения" })}>
              <select
                value={form.movement_type}
                onChange={(e) => setForm({ ...form, movement_type: e.target.value as Movement["movement_type"] })}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="purchase">{t("inventory.type.purchase", { defaultValue: "Приход" })}</option>
                <option value="adjustment_in">{t("inventory.type.adjustment_in", { defaultValue: "Коррекция +" })}</option>
                <option value="adjustment_out">{t("inventory.type.adjustment_out", { defaultValue: "Коррекция −" })}</option>
                <option value="manual_consumption">{t("inventory.type.manual_consumption", { defaultValue: "Списание (вручную)" })}</option>
              </select>
            </Field>
            <Field label={t("inventory.amount", { defaultValue: "Количество" })}>
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={form.delta}
                onChange={(e) => setForm({ ...form, delta: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                required
              />
            </Field>
            {form.movement_type === "purchase" && (
              <Field label={t("inventory.cost", { defaultValue: "Стоимость прихода (€)" })}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.cost_cents}
                  onChange={(e) => setForm({ ...form, cost_cents: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
                />
              </Field>
            )}
            <Field label={t("inventory.col.notes", { defaultValue: "Комментарий" })}>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 text-sm text-white"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">
                {t("common.cancel")}
              </button>
              <button type="submit" className="rounded-lg bg-sky-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-500">
                {t("common.save", { defaultValue: "Сохранить" })}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-zinc-500">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <h3 className="mb-3 text-base font-semibold text-white">{title}</h3>
        {children}
      </div>
    </div>
  );
}
