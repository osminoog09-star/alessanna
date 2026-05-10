/**
 * Порядок блоков страницы записи (/book) и ресепшена (/reception).
 * Источник истины — salon_settings.reception_section_order; localStorage — кэш офлайн.
 */

export const RECEPTION_LAYOUT_STORAGE_KEY = "alesanna-reception-section-order-v1";

export const RECEPTION_SECTION_IDS = ["calendar", "upcoming", "masters", "booking"] as const;

export type ReceptionSectionId = (typeof RECEPTION_SECTION_IDS)[number];

export const DEFAULT_RECEPTION_SECTION_ORDER: ReceptionSectionId[] = [...RECEPTION_SECTION_IDS];

function isSectionId(s: string): s is ReceptionSectionId {
  return (RECEPTION_SECTION_IDS as readonly string[]).includes(s);
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

export function loadReceptionSectionOrder(): ReceptionSectionId[] {
  try {
    const raw = localStorage.getItem(RECEPTION_LAYOUT_STORAGE_KEY);
    if (!raw) return [...DEFAULT_RECEPTION_SECTION_ORDER];
    return normalizeReceptionSectionOrder(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_RECEPTION_SECTION_ORDER];
  }
}

export function persistReceptionSectionOrder(order: ReceptionSectionId[]): void {
  try {
    localStorage.setItem(RECEPTION_LAYOUT_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* quota / private mode */
  }
}
