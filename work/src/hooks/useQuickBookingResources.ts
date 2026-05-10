import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  isStaffRowAdmin,
  isStaffShownOnPublicMarketing,
  normalizeStaffMember,
  staffEligibleForService,
} from "../lib/roles";
import {
  classifyServiceHall,
  publicBookableStaffMembers,
  splitStaffIntoHairAndNails,
} from "../lib/publicMasterPanel";
import {
  DEFAULT_RECEPTION_MASTERS_PANEL,
  loadReceptionLayoutStore,
  persistReceptionLayoutStore,
  type ReceptionMastersPanelConfig,
} from "../lib/receptionLayout";
import { fetchReceptionLayoutFromServer } from "../lib/receptionLayoutRemote";
import {
  normalizePublicBookingDayStr,
  salonDayStartUtc,
  salonFirstBookableYmd,
} from "../lib/bookingSalonTz";
import type { AppointmentRow, StaffMember, StaffScheduleRow, StaffServiceRow } from "../types/database";

export type QuickPublicService = {
  id: string;
  name: string;
  duration_min: number;
  buffer_after_min: number;
  active: boolean;
  categoryName: string | null;
  priceEur: number | null;
};

export function useQuickBookingResources() {
  const [services, setServices] = useState<QuickPublicService[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffMember[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [links, setLinks] = useState<StaffServiceRow[]>([]);
  const [schedules, setSchedules] = useState<StaffScheduleRow[]>([]);
  const [receptionMastersConfig, setReceptionMastersConfig] = useState<ReceptionMastersPanelConfig>(() => ({
    ...DEFAULT_RECEPTION_MASTERS_PANEL,
  }));
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [timeOff, setTimeOff] = useState<
    Array<{ staff_id: string; start_time: string; end_time: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [bookYmd, setBookYmd] = useState(() => salonFirstBookableYmd());
  const [nowTick, setNowTick] = useState(() => Date.now());

  const bookYmdNorm = useMemo(() => normalizePublicBookingDayStr(bookYmd), [bookYmd]);

  const loadBase = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const [st, lk, sc, remoteLayout] = await Promise.all([
      supabase.from("staff").select("*").eq("is_active", true).order("name"),
      supabase.from("staff_services").select("*"),
      supabase.from("staff_schedule").select("*"),
      fetchReceptionLayoutFromServer(),
    ]);
    let sv = await supabase
      .from("service_listings")
      .select(
        "id,name,duration,buffer_after_min,is_active,category_id,price,service_categories(name)",
      )
      .order("name");
    if (sv.error) {
      sv = (await supabase
        .from("service_listings")
        .select("id,name,duration,buffer_after_min,is_active,price")
        .order("name")) as typeof sv;
    }
    if (sv.error) {
      sv = (await supabase.from("service_listings").select("id,name,duration,is_active").order("name")) as typeof sv;
    }
    if (sv.data) {
      type SvRow = {
        id: string;
        name: string;
        duration?: number;
        buffer_after_min?: number;
        is_active?: boolean;
        price?: number | null;
        service_categories?: { name?: string | null } | null;
      };
      const normalized = (sv.data as SvRow[]).map((s) => {
        const catName = String(s.service_categories?.name || "").trim();
        const priceRaw = s.price;
        const priceEur =
          priceRaw != null && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
        return {
          id: String(s.id),
          name: String(s.name || "").trim(),
          duration_min: Number(s.duration || 0),
          buffer_after_min: Number(s.buffer_after_min ?? 10),
          active: s.is_active !== false,
          categoryName: catName || null,
          priceEur,
        };
      });
      setServices(normalized);
    }
    if (st.data) {
      const directory = (st.data as Record<string, unknown>[])
        .filter((row) => !isStaffRowAdmin(row))
        .map((r) => normalizeStaffMember(r as StaffMember));
      setStaffDirectory(directory);
      setStaff(directory.filter((m) => isStaffShownOnPublicMarketing(m)));
    }
    if (lk.data) setLinks(lk.data as StaffServiceRow[]);
    if (sc.data) setSchedules(sc.data as StaffScheduleRow[]);
    if (remoteLayout) {
      setReceptionMastersConfig(remoteLayout.masters);
      persistReceptionLayoutStore(remoteLayout);
    } else {
      const local = loadReceptionLayoutStore();
      setReceptionMastersConfig(local.masters);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const mastersPanelStaff = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staffDirectory.map((m) => [m.id, m]));
      const ids = [
        ...new Set([...receptionMastersConfig.hairStaffIds, ...receptionMastersConfig.nailsStaffIds]),
      ];
      return ids.map((id) => byId.get(id)).filter((m): m is StaffMember => m != null);
    }
    return publicBookableStaffMembers(staff, links, services);
  }, [receptionMastersConfig, staffDirectory, staff, links, services]);

  /** Колонки «парикмахерский зал» / «маникюр» — как на /reception. */
  const mastersSplitResolved = useMemo(() => {
    if (receptionMastersConfig.assignment === "manual") {
      const byId = new Map(staffDirectory.map((m) => [m.id, m]));
      const pick = (ids: string[]) =>
        ids.map((id) => byId.get(id)).filter((m): m is StaffMember => m != null);
      return {
        hair: pick(receptionMastersConfig.hairStaffIds),
        nails: pick(receptionMastersConfig.nailsStaffIds),
      };
    }
    return splitStaffIntoHairAndNails(mastersPanelStaff, links, services);
  }, [receptionMastersConfig, staffDirectory, mastersPanelStaff, links, services]);

  const loadDayData = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    const eligibleIds = mastersPanelStaff.map((s) => s.id);
    if (!eligibleIds.length) {
      setAppointments([]);
      setTimeOff([]);
      return;
    }
    const start = salonDayStartUtc(bookYmdNorm);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [ap, to] = await Promise.all([
      supabase
        .from("appointments")
        .select("*")
        .in("staff_id", eligibleIds)
        .gte("start_time", start.toISOString())
        .lt("start_time", end.toISOString())
        .neq("status", "cancelled"),
      supabase
        .from("staff_time_off")
        .select("*")
        .in("staff_id", eligibleIds)
        .lte("start_time", end.toISOString())
        .gte("end_time", start.toISOString()),
    ]);
    if (ap.data) setAppointments(ap.data as AppointmentRow[]);
    if (to.data) {
      setTimeOff(
        (to.data as { staff_id: string; start_time: string; end_time: string }[]).map((r) => ({
          staff_id: r.staff_id,
          start_time: r.start_time,
          end_time: r.end_time,
        })),
      );
    }
  }, [bookYmdNorm, mastersPanelStaff]);

  useEffect(() => {
    void loadDayData();
  }, [loadDayData]);

  const eligibleStaffForService = useCallback(
    (serviceId: string | null) => {
      if (serviceId == null) return [];
      const svcEntry = services.find((s) => s.id === serviceId);
      const hall = classifyServiceHall(svcEntry);
      const hairIds = new Set(mastersSplitResolved.hair.map((m) => m.id));
      const nailIds = new Set(mastersSplitResolved.nails.map((m) => m.id));
      const panelIds =
        hall === "hair" ? hairIds : hall === "nail" ? nailIds : new Set(mastersPanelStaff.map((m) => m.id));

      const base = staffEligibleForService(staffDirectory, links, serviceId);
      const filtered = base.filter((m) => panelIds.has(m.id));
      const orderList =
        hall === "hair"
          ? mastersSplitResolved.hair
          : hall === "nail"
            ? mastersSplitResolved.nails
            : mastersPanelStaff;
      const order = new Map(orderList.map((m, i) => [m.id, i]));
      return filtered.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
    },
    [staffDirectory, links, mastersPanelStaff, mastersSplitResolved, services],
  );

  return {
    loading,
    services,
    staffDirectory,
    links,
    schedules,
    mastersPanelStaff,
    appointments,
    timeOff,
    bookYmd,
    setBookYmd,
    bookYmdNorm,
    nowTick,
    loadBase,
    loadDayData,
    eligibleStaffForService,
  };
}
