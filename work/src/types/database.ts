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
  /** false = hidden from marketing site + public booking (CRM still sees the person). */
  show_on_marketing_site?: boolean;
};

/** How the salon pays an employee (finance / payouts). */
export type StaffWorkType = "percentage" | "rent" | "salary";

/** Raw `staff` row (Supabase). */
export type StaffTableRow = {
  id: string;
  phone: string | null;
  name: string;
  role: Role;
  roles?: StaffRole[] | null;
  is_active: boolean;
  show_on_marketing_site?: boolean;
  created_at?: string;
  /** Optional finance settings. */
  work_type?: StaffWorkType | null;
  /** Percentage (0-100) paid to the employee when `work_type === "percentage"`. */
  percent_rate?: number | null;
  /** Daily rent in cents paid by the employee when `work_type === "rent"`. */
  rent_per_day?: number | null;
  /** Personal Google/Apple calendar e-mail for a future sync job. */
  calendar_email?: string | null;
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
  /** Row hydrated from service_listings when `services` has no rows; edits persist to listings by id. */
  catalogSource?: "listing";
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
  /** Свободный комментарий клиента из формы записи; колонка appointments.note. */
  note: string | null;
  /** Backwards-compat: старое имя поля, использовалось до миграции 030.
   *  Оставлено только чтобы не упасть, если где-то ещё читают `.notes`. */
  notes?: string | null;
  client_id?: string | null;
  created_at?: string;
};

export type StaffScheduleRow = {
  id: string;
  staff_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

/** Why the employee is off: vacation, sick leave, ad-hoc block, etc.
 *  Covers both historical (`manual_block`, `sick_leave`, `day_off`) and new values
 *  (`vacation`, `sick`, `personal`, `block`, `other`) so migration rows from either
 *  era type-check. */
export type TimeOffType =
  | "vacation"
  | "sick"
  | "sick_leave"
  | "day_off"
  | "personal"
  | "block"
  | "manual_block"
  | "other";

export type StaffTimeOffRow = {
  id: string;
  staff_id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  time_off_type?: TimeOffType | null;
};

export type StaffServiceRow = {
  staff_id: string;
  service_id: string | number;
  /** false = CRM only; hidden from public team + public booking */
  show_on_site?: boolean;
};

/** Public catalog row (`service_listings`) — new UUID-based source of truth. */
export type ServiceListingRow = {
  id: string;
  name: string;
  category_id: string | null;
  duration: number | null;
  buffer_after_min: number | null;
  price: number | null;
  is_active: boolean;
  created_at?: string;
};

/** CRM client/visit rows. */
export type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at?: string;
};

/** Public site builder blocks stored in `site_blocks`.
 *  Source of truth: миграция 017_site_builder_real_mvp.sql
 *    check (type in ('button', 'text', 'section', 'image', 'spacer'))
 *  Старые «маркетинговые» типы (hero/cta/…) пока не реализованы — намеренно
 *  выкинуты из юниона, чтобы редактор и preview не отрисовывали то, чего
 *  в БД быть не может. */
export type SiteBlockType = "button" | "text" | "section" | "image" | "spacer";

export type SiteBlockRow = {
  id: string;
  page_id: string | null;
  type: SiteBlockType;
  position: number;
  content: Record<string, unknown> | null;
  styles: Record<string, unknown> | null;
  /** В 017_site_builder_real_mvp.sql колонки `is_active` нет; оставляем
   *  опциональной — это не ломает редактор и не сломает старые таблицы,
   *  если кто-то вручную её добавил. */
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

/** Source of truth: 015_site_builder_mvp.sql + 017 + 032.
 *  Поля name/slug/status/styles реально присутствуют в БД, без них
 *  и SiteBuilderPage, и публикация страниц упадут. */
export type SitePageRow = {
  id: string;
  name: string;
  slug: string;
  /** 'draft' | 'published' (см. site_pages_status_check в миграции 017) */
  status: "draft" | "published";
  /** JSON со шрифтами/maxWidth страницы; миграция 017 добавляет default '{}'. */
  styles: Record<string, unknown> | null;
  /** Опциональные тайм-стампы из миграций 017/032. */
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  /** Backwards-compat: миграция 015 не имела поля title; держим опционально,
   *  чтобы не сломать чужие интеграции, если они его читают. */
  title?: string | null;
  is_published?: boolean;
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
