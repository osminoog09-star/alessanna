-- Allow adding staff without a phone number (useful for masters that never log
-- into the CRM themselves but still appear on /admin/staff and the public site).
--
-- Changes:
--   * public.staff.phone: drop NOT NULL
--   * Normalize accidental empty strings to NULL so the partial unique index
--     below treats them as "no phone" rather than as a single "" value.
--   * Replace the existing table-level UNIQUE(phone) with a partial unique
--     index that only enforces uniqueness when a phone is actually present.

alter table public.staff alter column phone drop not null;

update public.staff set phone = null where phone is not null and btrim(phone) = '';

alter table public.staff drop constraint if exists staff_phone_key;

create unique index if not exists uq_staff_phone_not_null
  on public.staff (phone)
  where phone is not null;

comment on column public.staff.phone is
  'Optional phone used for CRM login. NULL is allowed for staff who never log in themselves; uniqueness is enforced only for non-null values via uq_staff_phone_not_null.';
