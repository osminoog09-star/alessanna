/** Types aligned with supabase/migrations (staff, appointment_services, service_listings, …). */

export type Role = "owner" | "admin" | "manager" | "worker";
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

export type StaffWorkType = "percentage" | "rent";

/** Raw `staff` row (Supabase). */
export type StaffTableRow = {
  id: string;
  phone: string | null;
  name: string;
  role: Role;
  roles?: Role[] | null;
  is_active: boolean;
  work_type?: StaffWorkType | null;
  percent_rate?: number | null;
  rent_per_day?: number | null;
  created_at?: string;
};

/** `service_categories` — website + CRM. */
export type ServiceCategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at?: string;
};

/** `service_listings` — single catalog for CRM, booking, website. */
export type ServiceListingRow = {
  id: string;
  name: string;
  price: number | null;
  duration: number | null;
  buffer_after_min: number;
  category_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
};

/** Visit header (one client, many lines in `appointment_services`). */
export type AppointmentRow = {
  id: string;
  client_id?: string | null;
  client_name: string;
  client_phone: string | null;
  status: "pending" | "confirmed" | "cancelled";
  source: string;
  notes: string | null;
  created_at?: string;
};

/** Single scheduled service line within a visit. */
export type AppointmentServiceRow = {
  id: string;
  appointment_id: string;
  service_id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
};

export type StaffScheduleRow = {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type TimeOffType = "sick_leave" | "day_off" | "manual_block";

export type StaffTimeOffRow = {
  id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  time_off_type?: TimeOffType;
};

export type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  created_at?: string;
};

export type StaffWorkDayRow = {
  id: string;
  staff_id: string;
  date: string;
  is_working: boolean;
  created_at?: string;
};

export type StaffServiceRow = {
  staff_id: string;
  service_id: string;
};

export type SitePageRow = {
  id: string;
  name: string;
  slug: string;
  created_at?: string;
};

export type SiteBlockType = "button" | "text" | "section";

export type SiteBlockRow = {
  id: string;
  page_id: string;
  type: SiteBlockType;
  content: Record<string, unknown>;
  position: number;
  created_at?: string;
};

export type Database = {
  public: {
    Tables: {
      staff: { Row: StaffTableRow; Insert: Partial<StaffTableRow>; Update: Partial<StaffTableRow> };
      service_listings: {
        Row: ServiceListingRow;
        Insert: Partial<ServiceListingRow>;
        Update: Partial<ServiceListingRow>;
      };
      service_categories: {
        Row: ServiceCategoryRow;
        Insert: Partial<ServiceCategoryRow>;
        Update: Partial<ServiceCategoryRow>;
      };
      staff_services: { Row: StaffServiceRow; Insert: StaffServiceRow; Update: Partial<StaffServiceRow> };
      staff_schedule: { Row: StaffScheduleRow; Insert: Partial<StaffScheduleRow>; Update: Partial<StaffScheduleRow> };
      staff_time_off: { Row: StaffTimeOffRow; Insert: Partial<StaffTimeOffRow>; Update: Partial<StaffTimeOffRow> };
      appointments: { Row: AppointmentRow; Insert: Partial<AppointmentRow>; Update: Partial<AppointmentRow> };
      appointment_services: {
        Row: AppointmentServiceRow;
        Insert: Partial<AppointmentServiceRow>;
        Update: Partial<AppointmentServiceRow>;
      };
      clients: { Row: ClientRow; Insert: Partial<ClientRow>; Update: Partial<ClientRow> };
      staff_work_days: {
        Row: StaffWorkDayRow;
        Insert: Partial<StaffWorkDayRow>;
        Update: Partial<StaffWorkDayRow>;
      };
      site_pages: { Row: SitePageRow; Insert: Partial<SitePageRow>; Update: Partial<SitePageRow> };
      site_blocks: { Row: SiteBlockRow; Insert: Partial<SiteBlockRow>; Update: Partial<SiteBlockRow> };
    };
    Functions: {
      verify_staff_phone: {
        Args: { phone_input: string };
        Returns: boolean | Record<string, unknown> | null;
      };
    };
  };
};
