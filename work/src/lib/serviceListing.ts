import type { ServiceListingRow } from "../types/database";

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
