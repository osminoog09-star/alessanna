import { addMinutes } from "date-fns";
import type { ServiceListingRow } from "../types/database";
import { listingBufferMinutes, listingDurationMinutes } from "./serviceListing";

export type ServiceStaffPick = { serviceId: string; staffId: string };

export type PlannedSegment = {
  serviceId: string;
  staffId: string;
  start: Date;
  end: Date;
};

/** Sequential chain: each service starts when the previous ends (same visit). */
export function computeSequentialSegments(
  chainStart: Date,
  ordered: ServiceStaffPick[],
  listings: ServiceListingRow[]
): PlannedSegment[] | null {
  const out: PlannedSegment[] = [];
  let t = chainStart;
  for (const item of ordered) {
    const svc = listings.find((s) => s.id === item.serviceId);
    if (!svc) return null;
    const start = t;
    const end = addMinutes(start, listingDurationMinutes(svc) + listingBufferMinutes(svc));
    out.push({ serviceId: item.serviceId, staffId: item.staffId, start, end });
    t = end;
  }
  return out;
}
