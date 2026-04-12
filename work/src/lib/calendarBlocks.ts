/** Flattened row for calendar / timeline (one block per service line). */
export type CalendarServiceBlock = {
  id: string;
  appointment_id: string;
  staff_id: string;
  service_id: number;
  start_time: string;
  end_time: string;
  client_name: string;
  service_name_et: string;
  staff_name: string;
  appointment_status: string;
};

export type SupabaseAppointmentServiceJoinRow = {
  id: string;
  appointment_id: string;
  staff_id: string;
  service_id: number;
  start_time: string;
  end_time: string;
  appointments: { id: string; status: string; client_name: string; client_phone: string | null } | null;
  services: { id: number; name_et: string } | null;
  staff: { id: string; name: string } | null;
};

export function mapAppointmentServiceRowsToBlocks(
  rows: SupabaseAppointmentServiceJoinRow[] | null
): CalendarServiceBlock[] {
  if (!rows?.length) return [];
  return rows
    .filter((r) => r.appointments && r.appointments.status !== "cancelled")
    .map((r) => ({
      id: r.id,
      appointment_id: r.appointment_id,
      staff_id: r.staff_id,
      service_id: r.service_id,
      start_time: r.start_time,
      end_time: r.end_time,
      client_name: r.appointments?.client_name ?? "",
      service_name_et: r.services?.name_et ?? "",
      staff_name: r.staff?.name ?? "",
      appointment_status: r.appointments?.status ?? "confirmed",
    }));
}
