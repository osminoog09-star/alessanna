import { addMinutes } from "date-fns";
import type { ServiceRow } from "../types/database";

export type ServiceStaffPick = { serviceId: number; staffId: string };

export type PlannedSegment = {
  serviceId: number;
  staffId: string;
  start: Date;
  end: Date;
};

/** Sequential chain: each service starts when the previous ends (same visit). */
export function computeSequentialSegments(
  chainStart: Date,
  ordered: ServiceStaffPick[],
  services: ServiceRow[]
): PlannedSegment[] | null {
  const out: PlannedSegment[] = [];
  let t = chainStart;
  for (const item of ordered) {
    const svc = services.find((s) => s.id === item.serviceId);
    if (!svc) return null;
    const start = t;
    const end = addMinutes(start, svc.duration_min + svc.buffer_after_min);
    out.push({ serviceId: item.serviceId, staffId: item.staffId, start, end });
    t = end;
  }
  return out;
}
