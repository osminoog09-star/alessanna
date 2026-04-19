import { supabase } from "./supabase";
import type { ServiceRow } from "../types/database";

/**
 * Единая точка загрузки каталога услуг для всего CRM.
 *
 * **Зачем нужен этот файл.** В проекте исторически живут две таблицы:
 *  - `service_listings` (UUID, новый каталог, его читает публичный сайт; колонки
 *    `name`, `price`, `duration`, `is_active`).
 *  - `services` (legacy bigint, старая таблица; колонки `name_et`, `price_cents`,
 *    `duration_min`, `active`).
 *
 * После миграции 012 «истина» — `service_listings`, а `services` обычно пустая
 * (или содержит старые данные). Раньше каждая страница CRM решала сама, откуда
 * читать каталог, и это уже привело к багу: модалка «Новая запись» в календаре
 * молча показывала пустой dropdown «Услуга», потому что грузила только из
 * `services` (а там 0 строк).
 *
 * Эта функция:
 *   1. Сначала тянет `service_listings` (приоритет — это «живой» каталог).
 *   2. Если он пустой/недоступен — fallback на `services` (legacy).
 *   3. Маппит обе таблицы в общий тип `ServiceRow`, чтобы UI не пришлось знать,
 *      из какого источника пришла строка.
 *
 * Опции:
 *  - `activeOnly`: если true — отбрасываются записи с `active = false`. Дефолт false
 *    (нужно для CRUD-страницы услуг, где надо видеть выключенные тоже).
 */
export type LoadServicesOpts = {
  activeOnly?: boolean;
};

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

type LegacyServiceRow = {
  id: unknown;
  name_et?: string | null;
  name_en?: string | null;
  category?: string | null;
  category_id?: string | number | null;
  duration_min?: number | null;
  buffer_after_min?: number | null;
  price_cents?: number | null;
  active?: boolean | null;
  is_active?: boolean | null;
  sort_order?: number | null;
  created_at?: string | null;
};

async function fetchFromListings(): Promise<ServiceRow[]> {
  /* Schema-drift fallback: некоторые старые проекты не имеют buffer_after_min/is_active. */
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
      catalogSource: "listing" as const,
    };
  });
}

async function fetchFromLegacyServices(): Promise<ServiceRow[]> {
  /* Legacy services — старая таблица, могла иметь либо `name_et`/`price_cents`,
   *  либо `name`/`price` (зависит от истории проекта). Делаем мягкий fallback. */
  const sLegacy = await supabase.from("services").select("*").order("sort_order", { ascending: true });
  if (!sLegacy.error && sLegacy.data && sLegacy.data.length > 0) {
    return (sLegacy.data as LegacyServiceRow[]).map((r, idx) => ({
      id: String(r.id ?? ""),
      slug: null,
      name_et: String(r.name_et || ""),
      name_en: r.name_en != null ? String(r.name_en) : null,
      category: r.category != null ? String(r.category) : null,
      category_id: r.category_id != null ? String(r.category_id) : null,
      duration_min: Number(r.duration_min || 0),
      buffer_after_min: Number(r.buffer_after_min ?? 10),
      price_cents: Number(r.price_cents || 0),
      active: r.active !== false && r.is_active !== false,
      sort_order: Number(r.sort_order ?? idx),
      created_at: r.created_at != null ? String(r.created_at) : undefined,
    }));
  }

  /* Тут «другой» legacy: services с колонками name/price/duration. */
  let sModern = await supabase
    .from("services")
    .select("id,name,category,duration,buffer_after_min,price,active,is_active,created_at")
    .order("name", { ascending: true });
  if (sModern.error && String(sModern.error.message || "").includes("buffer_after_min")) {
    sModern = (await supabase
      .from("services")
      .select("id,name,category,duration,price,active,is_active,created_at")
      .order("name", { ascending: true })) as typeof sModern;
  }
  if (!sModern.data?.length) return [];

  return (sModern.data as Array<Record<string, unknown>>).map((r, idx) => {
    const priceNum = Number(r.price);
    return {
      id: String(r.id ?? ""),
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

/** Загрузить весь каталог услуг (в едином формате `ServiceRow`). */
export async function loadServicesCatalog(opts: LoadServicesOpts = {}): Promise<ServiceRow[]> {
  const fromListings = await fetchFromListings();
  const all = fromListings.length > 0 ? fromListings : await fetchFromLegacyServices();
  return opts.activeOnly ? all.filter((s) => s.active) : all;
}
