import { useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

function subscribeTables(
  channelName: string,
  tables: string[],
  onChangeRef: React.MutableRefObject<() => void>
): () => void {
  if (!isSupabaseConfigured()) return () => undefined;
  const channel = supabase.channel(channelName);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      void onChangeRef.current();
    });
  }
  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Refetch when `bookings` changes (enable Realtime on `bookings` in Supabase). */
export function useBookingsRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-bookings", ["bookings"], onChangeRef), []);
}

/** Calendar grid: bookings, schedules, skills, services. */
export function useCalendarDataRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => subscribeTables("crm-calendar", ["bookings", "schedules", "employee_services", "services"], onChangeRef),
    []
  );
}

/** Analytics: revenue uses bookings + service prices; earnings table. */
export function useAnalyticsRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-analytics", ["bookings", "services", "earnings"], onChangeRef), []);
}

/** Services list / prices in CRM. */
export function useServicesCatalogRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-services", ["services"], onChangeRef), []);
}

/** Staff roster and skills (employee_services). */
export function useEmployeesDirectoryRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-employees", ["employees", "employee_services"], onChangeRef), []);
}
