-- 024b_appointments_service_listings_fk.sql
-- Дополнение к 012_service_listings_fk.sql: перетаскивает FK
-- appointments.service_id + appointment_services.service_id на public.service_listings.
--
-- Исторически 012 пересаживал только appointment_services.* и только при
-- определённом типе колонки (int8). На production-проекте AlesSanna это
-- оставило обе ссылки на пустую legacy-таблицу public.services, из-за чего
-- public_book_chain падал на FK-constraint при первой же записи через сайт.
--
-- Скрипт идемпотентен: если FK уже показывает на service_listings — no-op.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_service_id_fkey'
      and confrelid <> 'public.service_listings'::regclass
  ) then
    alter table public.appointments drop constraint appointments_service_id_fkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_service_id_fkey'
  ) then
    alter table public.appointments
      add constraint appointments_service_id_fkey
      foreign key (service_id) references public.service_listings (id) on delete restrict;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_services'::regclass
      and conname = 'appointment_services_service_id_fkey'
      and confrelid <> 'public.service_listings'::regclass
  ) then
    alter table public.appointment_services drop constraint appointment_services_service_id_fkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointment_services'::regclass
      and conname = 'appointment_services_service_id_fkey'
  ) then
    alter table public.appointment_services
      add constraint appointment_services_service_id_fkey
      foreign key (service_id) references public.service_listings (id) on delete restrict;
  end if;
end $$;
