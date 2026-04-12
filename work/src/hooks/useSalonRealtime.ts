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

export function useBookingsRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => subscribeTables("crm-appointments", ["appointments", "appointment_services"], onChangeRef),
    []
  );
}

export function useCalendarDataRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () =>
      subscribeTables(
        "crm-calendar",
        [
          "appointments",
          "appointment_services",
          "staff_schedule",
          "staff_time_off",
          "staff_services",
          "services",
        ],
        onChangeRef
      ),
    []
  );
}

export function useAnalyticsRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () =>
      subscribeTables("crm-analytics", ["appointments", "appointment_services", "services", "staff"], onChangeRef),
    []
  );
}

export function useServicesCatalogRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-services", ["services"], onChangeRef), []);
}

export function useEmployeesDirectoryRealtime(onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => subscribeTables("crm-staff-dir", ["staff", "staff_services"], onChangeRef), []);
}
