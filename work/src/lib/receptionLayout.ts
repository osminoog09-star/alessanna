/**
 * Макет страницы записи (/book) и ресепшена (/reception): строки по вертикали,
 * в строке 1 или 2 модуля (на md+ — две колонки).
 * Источник истины — salon_settings.reception_section_order (JSON); localStorage — кэш.
 */

export const RECEPTION_LAYOUT_STORAGE_KEY = "alesanna-reception-section-order-v1";
export const RECEPTION_LAYOUT_STORAGE_KEY_V2 = "alesanna-reception-layout-v2";

export const RECEPTION_SECTION_IDS = ["calendar", "upcoming", "masters", "booking"] as const;

export type ReceptionSectionId = (typeof RECEPTION_SECTION_IDS)[number];

/** Строки макета: каждая строка — 1 или 2 уникальных модуля (все четыре ровно один раз). */
export type ReceptionRows = ReceptionSectionId[][];

export const DEFAULT_RECEPTION_SECTION_ORDER: ReceptionSectionId[] = [...RECEPTION_SECTION_IDS];

export const DEFAULT_RECEPTION_ROWS: ReceptionRows = [
  ["calendar", "upcoming"],
  ["masters"],
  ["booking"],
];

function isSectionId(s: string): s is ReceptionSectionId {
  return (RECEPTION_SECTION_IDS as readonly string[]).includes(s);
}

/** Стабильный id строки для dnd-kit: порядок колонок важен. */
export function receptionRowSortableId(cells: readonly ReceptionSectionId[]): string {
  return cells.join("|");
}

export function flattenReceptionRows(rows: ReceptionRows): ReceptionSectionId[] {
  return rows.flat();
}

/** Старый плоский порядок → строки (склейка только calendar+upcoming подряд, как в legacy-рендере). */
export function legacyOrderToRows(order: ReceptionSectionId[]): ReceptionRows {
  const rows: ReceptionRows = [];
  let i = 0;
  while (i < order.length) {
    const id = order[i]!;
    const next = order[i + 1];
    const paired =
      (id === "calendar" && next === "upcoming") || (id === "upcoming" && next === "calendar");
    if (paired) {
      rows.push([id, next!]);
      i += 2;
    } else {
      rows.push([id]);
      i += 1;
    }
  }
  return rows;
}

function validateReceptionRows(input: unknown[]): ReceptionRows | null {
  if (!input.length) return null;
  const seen = new Set<ReceptionSectionId>();
  const out: ReceptionRows = [];
  for (const row of input) {
    if (!Array.isArray(row) || row.length < 1 || row.length > 2) return null;
    const cells: ReceptionSectionId[] = [];
    for (const c of row) {
      if (typeof c !== "string" || !isSectionId(c)) return null;
      if (seen.has(c)) return null;
      seen.add(c);
      cells.push(c);
    }
    out.push(cells.length === 2 ? [cells[0]!, cells[1]!] : [cells[0]!]);
  }
  if (seen.size !== RECEPTION_SECTION_IDS.length) return null;
  for (const id of RECEPTION_SECTION_IDS) {
    if (!seen.has(id)) return null;
  }
  return out;
}

/**
 * Нормализация из БД / localStorage:
 * - `{ "rows": [["calendar","upcoming"],["masters"],["booking"]] }`
 * - legacy плоский массив строк
 * - legacy массив массивов без обёртки
 */
export function normalizeReceptionRows(raw: unknown): ReceptionRows {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw) && "rows" in raw) {
    const rows = (raw as { rows: unknown }).rows;
    if (Array.isArray(rows)) {
      const ok = validateReceptionRows(rows);
      if (ok) return ok.map((r) => [...r]);
    }
  }
  if (Array.isArray(raw) && raw.length > 0) {
    if (Array.isArray(raw[0])) {
      const ok = validateReceptionRows(raw as unknown[]);
      if (ok) return ok.map((r) => [...r]);
    }
    if (typeof raw[0] === "string") {
      return legacyOrderToRows(normalizeReceptionSectionOrder(raw));
    }
  }
  return DEFAULT_RECEPTION_ROWS.map((r) => [...r]);
}

export function normalizeReceptionSectionOrder(raw: unknown): ReceptionSectionId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_RECEPTION_SECTION_ORDER];
  const seen = new Set<ReceptionSectionId>();
  const out: ReceptionSectionId[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isSectionId(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  for (const id of RECEPTION_SECTION_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function loadReceptionLayoutRows(): ReceptionRows {
  try {
    const v2 = localStorage.getItem(RECEPTION_LAYOUT_STORAGE_KEY_V2);
    if (v2) return normalizeReceptionRows(JSON.parse(v2) as unknown);
    const v1 = localStorage.getItem(RECEPTION_LAYOUT_STORAGE_KEY);
    if (v1) {
      const rows = legacyOrderToRows(normalizeReceptionSectionOrder(JSON.parse(v1) as unknown));
      persistReceptionLayoutRows(rows);
      return rows;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_RECEPTION_ROWS.map((r) => [...r]);
}

export function persistReceptionLayoutRows(rows: ReceptionRows): void {
  try {
    localStorage.setItem(RECEPTION_LAYOUT_STORAGE_KEY_V2, JSON.stringify({ rows }));
  } catch {
    /* quota / private mode */
  }
}

/** @deprecated только для обратной совместимости */
export function loadReceptionSectionOrder(): ReceptionSectionId[] {
  return flattenReceptionRows(loadReceptionLayoutRows());
}

/** @deprecated */
export function persistReceptionSectionOrder(order: ReceptionSectionId[]): void {
  persistReceptionLayoutRows(legacyOrderToRows(normalizeReceptionSectionOrder(order)));
}

export function mergeRowWithNext(rows: ReceptionRows, index: number): ReceptionRows {
  const a = rows[index];
  const b = rows[index + 1];
  if (!a || !b || a.length !== 1 || b.length !== 1) return rows;
  const next = rows.slice();
  next.splice(index, 2, [a[0]!, b[0]!]);
  return next;
}

export function splitPairedRow(rows: ReceptionRows, index: number): ReceptionRows {
  const r = rows[index];
  if (!r || r.length !== 2) return rows;
  const next = [...rows];
  next.splice(index, 1, [r[0]!], [r[1]!]);
  return next;
}

export function swapCellsInRow(rows: ReceptionRows, index: number): ReceptionRows {
  const r = rows[index];
  if (!r || r.length !== 2) return rows;
  const next = [...rows];
  next[index] = [r[1]!, r[0]!];
  return next;
}
