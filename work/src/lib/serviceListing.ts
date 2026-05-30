import type { ServiceListingRow } from "../types/database";

/** Bookable / visible in UI when not explicitly disabled (legacy rows without `is_active` count as active). */
export function serviceListingIsActive(s: Pick<ServiceListingRow, "is_active"> | { is_active?: boolean | null }): boolean {
  return (s as { is_active?: boolean | null }).is_active !== false;
}

export function listingDurationMinutes(s: Pick<ServiceListingRow, "duration">): number {
  return Math.max(1, s.duration ?? 60);
}

/** At least 5 minutes after each service (CRM standard gap). */
const MIN_BUFFER_AFTER_MIN = 5;

export function listingBufferMinutes(s: Pick<ServiceListingRow, "buffer_after_min">): number {
  return Math.max(MIN_BUFFER_AFTER_MIN, s.buffer_after_min ?? 0);
}

export function listingSlotMinutes(s: ServiceListingRow): number {
  return listingDurationMinutes(s) + listingBufferMinutes(s);
}

/** Revenue / analytics: euros stored in `price` → integer cents. */
export function listingPriceCents(s: Pick<ServiceListingRow, "price">): number {
  return Math.round(Number(s.price ?? 0) * 100);
}

/** Range upper bound: `price_max` euros (nullable) → integer cents, or null when unset. */
export function listingPriceMaxCents(priceMax: unknown): number | null {
  return priceMax != null ? Math.round(Number(priceMax) * 100) : null;
}

/** ServiceRow.price_max_cents → euros for display/persistence; 0 or null means "no range". */
export function priceMaxEur(priceMaxCents: number | null | undefined): number | null {
  return (priceMaxCents ?? 0) > 0 ? (priceMaxCents ?? 0) / 100 : null;
}
