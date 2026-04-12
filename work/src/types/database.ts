/** Manual types aligned with supabase/migrations (001 + 002 + 004 roles array). */

export type StaffRole = "admin" | "manager" | "employee";

export type EmployeeRow = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  slug: string | null;
  /** Multi-role access; use `lib/roles` helpers. */
  roles: StaffRole[];
  payroll_type: "percent" | "fixed";
  commission: number;
  fixed_salary: number;
  created_at?: string;
};

export type CategoryRow = {
  id: number;
  name: string;
  created_at?: string;
};

export type ServiceRow = {
  id: number;
  slug: string | null;
  name_et: string;
  name_en: string | null;
  category: string | null;
  category_id: number | null;
  duration_min: number;
  buffer_after_min: number;
  price_cents: number;
  active: boolean;
  sort_order: number;
  created_at?: string;
};

export type BookingRow = {
  id: number;
  service_id: number;
  employee_id: number;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  start_at: string;
  end_at: string;
  appointment_at: string | null;
  status: "pending" | "confirmed" | "cancelled";
  source: string;
  notes: string | null;
  created_at?: string;
};

export type ScheduleRow = {
  id: number;
  employee_id: number;
  day: number;
  start_time: string;
  end_time: string;
  status: "pending" | "approved";
  created_at?: string;
};

export type EarningRow = {
  id: number;
  employee_id: number;
  amount: number;
  date: string;
  created_at?: string;
};

export type EmployeeServiceRow = {
  employee_id: number;
  service_id: number;
};

export type Database = {
  public: {
    Tables: {
      employees: { Row: EmployeeRow; Insert: Partial<EmployeeRow>; Update: Partial<EmployeeRow> };
      categories: { Row: CategoryRow; Insert: Partial<CategoryRow>; Update: Partial<CategoryRow> };
      services: { Row: ServiceRow; Insert: Partial<ServiceRow>; Update: Partial<ServiceRow> };
      bookings: { Row: BookingRow; Insert: Partial<BookingRow>; Update: Partial<BookingRow> };
      schedules: { Row: ScheduleRow; Insert: Partial<ScheduleRow>; Update: Partial<ScheduleRow> };
      earnings: { Row: EarningRow; Insert: Partial<EarningRow>; Update: Partial<EarningRow> };
      employee_services: {
        Row: EmployeeServiceRow;
        Insert: EmployeeServiceRow;
        Update: Partial<EmployeeServiceRow>;
      };
    };
    Functions: {
      verify_staff_phone: { Args: { phone_input: string }; Returns: string | null };
    };
  };
};
