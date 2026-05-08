-- 061_google_calendar_salon_import_links.sql
-- -----------------------------------------------------------------------------
-- Исторический импорт записей из Google Calendar (ТОЛЬКО салонный календарь).
--
-- Зачем:
--   * нужен idempotent backfill: один и тот же google_event_id не должен
--     импортироваться в appointments второй раз;
--   * нужна трассировка "какая запись CRM создана из какого события Google".
-- -----------------------------------------------------------------------------

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google' check (provider = 'google'),
  calendar_scope text not null default 'salon' check (calendar_scope = 'salon'),
  google_calendar_id text not null,
  google_event_id text not null,
  google_event_status text,
  google_event_updated_at timestamptz,
  google_event_etag text,
  appointment_id uuid references public.appointments(id) on delete set null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw_event jsonb
);

create unique index if not exists uq_google_calendar_event_links_event
  on public.google_calendar_event_links (provider, calendar_scope, google_calendar_id, google_event_id);

create unique index if not exists uq_google_calendar_event_links_appointment
  on public.google_calendar_event_links (appointment_id)
  where appointment_id is not null;

create index if not exists idx_google_calendar_event_links_imported_at
  on public.google_calendar_event_links (imported_at desc);

alter table public.google_calendar_event_links enable row level security;

drop policy if exists google_calendar_event_links_read on public.google_calendar_event_links;
create policy google_calendar_event_links_read
  on public.google_calendar_event_links
  for select
  using (true);

create or replace function public.google_calendar_event_links_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_google_calendar_event_links_touch on public.google_calendar_event_links;
create trigger trg_google_calendar_event_links_touch
before update on public.google_calendar_event_links
for each row execute function public.google_calendar_event_links_touch_updated_at();

comment on table public.google_calendar_event_links is
  'Связь событий салонного Google Calendar с appointments для безопасного idempotent-импорта.';
