/** Types aligned with supabase/migrations (staff, appointments, staff_services, …). */

export type Role = "admin" | "manager" | "worker";
/** Same as Role; kept for clarity in staff-member shapes. */
export type StaffRole = Role;

/** Logged-in / roster person (from `staff` + normalized roles). */
export type StaffMember = {
  id: string;
  name: string;
  phone: string | null;
  /** Mirrors `staff.is_active` — bookable when true regardless of role. */
  active: boolean;
  roles: StaffRole[];
};

/** Raw `staff` row (Supabase). */
export type StaffTableRow = {
  id: string;
  phone: string | null;
  name: string;
  role: Role;
  roles?: StaffRole[] | null;
  is_active: boolean;
  created_at?: string;
};

export type CategoryRow = {
  id: number;
  name: string;
  created_at?: string;
};

export type ServiceRow = {
  id: string | number;
  slug: string | null;
  name_et: string;
  name_en: string | null;
  category: string | null;
  category_id: string | number | null;
  duration_min: number;
  buffer_after_min: number;
  price_cents: number;
  active: boolean;
  sort_order: number;
  created_at?: string;
};

export type AppointmentRow = {
  id: string;
  staff_id: string;
  service_id: string | number;
  client_name: string;
  client_phone: string | null;
  start_time: string;
  end_time: string;
  status: "pending" | "confirmed" | "cancelled";
  source: string;
  notes: string | null;
  created_at?: string;
};

export type StaffScheduleRow = {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type StaffTimeOffRow = {
  id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
};

export type StaffServiceRow = {
  staff_id: string;
  service_id: string | number;
};

export type Database = {
  public: {
    Tables: {
      staff: { Row: StaffTableRow; Insert: Partial<StaffTableRow>; Update: Partial<StaffTableRow> };
      services: { Row: ServiceRow; Insert: Partial<ServiceRow>; Update: Partial<ServiceRow> };
      staff_services: { Row: StaffServiceRow; Insert: StaffServiceRow; Update: Partial<StaffServiceRow> };
      staff_schedule: { Row: StaffScheduleRow; Insert: Partial<StaffScheduleRow>; Update: Partial<StaffScheduleRow> };
      staff_time_off: { Row: StaffTimeOffRow; Insert: Partial<StaffTimeOffRow>; Update: Partial<StaffTimeOffRow> };
      appointments: { Row: AppointmentRow; Insert: Partial<AppointmentRow>; Update: Partial<AppointmentRow> };
      categories: { Row: CategoryRow; Insert: Partial<CategoryRow>; Update: Partial<CategoryRow> };
    };
    Functions: {
      verify_staff_phone: { Args: { phone_input: string }; Returns: Record<string, unknown> | null };
    };
  };
};
