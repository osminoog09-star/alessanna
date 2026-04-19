-- 042_inventory.sql
-- ============================================================================
-- P1: Inventory tracking — расход материалов по услугам.
--
-- Бизнес-кейс: салон тратит лак, акрил, базы, гели и т.п. Сейчас — никак не
-- учитывается, узнают что закончилось когда остался один флакон. Нужно:
--   1. Каталог материалов с единицами измерения и текущим остатком.
--   2. Нормы расхода: сколько мл/штук уходит на одну услугу
--      (например «маникюр гель-лак» = 0.6 мл базы + 0.8 мл цвета + 0.4 мл топа).
--   3. Журнал движений (приход / расход / коррекция инвентаризации).
--   4. Авто-списание при завершении записи (appointments.status = 'completed').
--   5. Порог low-stock: запись с остатком ≤ порога подсвечивается в UI.
--
-- ============================================================================

-- ============================================================================
-- 1. Каталог материалов
-- ============================================================================

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- ml / pcs / g / box / pair — свободный enum строкой, фронт показывает.
  unit text not null default 'pcs',
  -- Текущий остаток (накапливаемый из movements). Денормализация ради скорости
  -- — SQL-триггер ниже синхронизирует значение при каждом movement.
  on_hand numeric(12, 3) not null default 0,
  -- Когда on_hand <= low_stock_threshold, в UI показываем предупреждение.
  -- NULL = не отслеживаем (служебка типа «коробка», расход редкий).
  low_stock_threshold numeric(12, 3),
  -- Категория для группировки в UI (опц.). Не FK, чтобы не плодить таблицы.
  category text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_items_active_idx
  on public.inventory_items (is_active);
create index if not exists inventory_items_low_stock_idx
  on public.inventory_items (on_hand)
  where low_stock_threshold is not null and is_active = true;

create or replace function public.inventory_items_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_items_touch on public.inventory_items;
create trigger trg_inventory_items_touch
  before update on public.inventory_items
  for each row execute function public.inventory_items_touch_updated_at();

-- ============================================================================
-- 2. Нормы расхода на услугу (service_listings)
-- ============================================================================
-- Нормы привязаны к service_listings (актуальный каталог), а не к services
-- (legacy, помечен deprecated). Если нужно списывать по обеим — фронт
-- сможет сам мапить.

create table if not exists public.inventory_consumption_norms (
  id uuid primary key default gen_random_uuid(),
  service_listing_id uuid not null
    references public.service_listings(id) on delete cascade,
  inventory_item_id uuid not null
    references public.inventory_items(id) on delete cascade,
  -- Сколько единиц (в `inventory_items.unit`) расходуется за 1 услугу.
  amount numeric(12, 3) not null check (amount > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (service_listing_id, inventory_item_id)
);

create index if not exists inventory_consumption_norms_service_idx
  on public.inventory_consumption_norms (service_listing_id);
create index if not exists inventory_consumption_norms_item_idx
  on public.inventory_consumption_norms (inventory_item_id);

-- ============================================================================
-- 3. Журнал движений
-- ============================================================================
-- Источник истины для on_hand. Любое изменение остатка идёт через INSERT сюда.
-- on_hand на inventory_items пересчитывается триггером.

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null
    references public.inventory_items(id) on delete restrict,
  -- 'purchase' (приход), 'consumption' (расход на услугу),
  -- 'adjustment_in' (коррекция +, например после инвентаризации),
  -- 'adjustment_out' (коррекция -, списание/брак),
  -- 'manual_consumption' (расход вне услуги — на пробник, на образец).
  movement_type text not null check (movement_type in (
    'purchase', 'consumption', 'adjustment_in', 'adjustment_out', 'manual_consumption'
  )),
  -- Знаковое количество: + если остаток увеличивается, - если уменьшается.
  -- Триггер ниже валидирует знак относительно movement_type.
  delta numeric(12, 3) not null check (delta <> 0),
  -- Снимок остатка ПОСЛЕ применения этого движения (для аудита).
  on_hand_after numeric(12, 3) not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  notes text,
  -- Стоимость прихода (опц., только для purchase). В центах.
  cost_cents bigint,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (inventory_item_id, created_at desc);
create index if not exists inventory_movements_appointment_idx
  on public.inventory_movements (appointment_id)
  where appointment_id is not null;
create index if not exists inventory_movements_type_idx
  on public.inventory_movements (movement_type);

-- ============================================================================
-- 4. Триггер: записать movement → обновить on_hand
-- ============================================================================

create or replace function public.inventory_apply_movement()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  current_on_hand numeric(12, 3);
  expected_sign int;
begin
  -- Валидация знака: purchase / adjustment_in → положительный delta;
  -- consumption / adjustment_out / manual_consumption → отрицательный.
  expected_sign := case new.movement_type
    when 'purchase' then 1
    when 'adjustment_in' then 1
    when 'consumption' then -1
    when 'adjustment_out' then -1
    when 'manual_consumption' then -1
    else 0
  end;
  if expected_sign = 1 and new.delta <= 0 then
    raise exception 'inventory_movements: % requires positive delta', new.movement_type;
  end if;
  if expected_sign = -1 and new.delta >= 0 then
    raise exception 'inventory_movements: % requires negative delta', new.movement_type;
  end if;

  -- Лочим строку item, чтобы избежать гонок при параллельных движениях.
  select on_hand into current_on_hand
  from public.inventory_items
  where id = new.inventory_item_id
  for update;

  if current_on_hand is null then
    raise exception 'inventory_movements: inventory_item_id % does not exist',
      new.inventory_item_id;
  end if;

  new.on_hand_after := current_on_hand + new.delta;

  update public.inventory_items
  set on_hand = new.on_hand_after
  where id = new.inventory_item_id;

  return new;
end;
$$;

drop trigger if exists trg_inventory_apply_movement on public.inventory_movements;
create trigger trg_inventory_apply_movement
  before insert on public.inventory_movements
  for each row execute function public.inventory_apply_movement();

-- ============================================================================
-- 5. RPC: списать материалы при completion услуги
-- ============================================================================
-- Идея: фронт вызывает РАЗ при переходе appointment в 'completed'.
-- Если по этой записи уже было списание (idempotency через
-- inventory_movements.appointment_id) — RPC пропускает.

create or replace function public.inventory_consume_for_appointment(
  appointment_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  apt public.appointments;
  norm record;
  total_movements int := 0;
  service_listing_ids uuid[];
begin
  select * into apt from public.appointments where id = appointment_id_input;
  if apt.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if apt.status <> 'completed' then
    return jsonb_build_object('status', 'not_completed');
  end if;

  -- Идемпотентность: если уже было списание по этой записи — выходим.
  if exists (
    select 1 from public.inventory_movements
    where appointment_id = appointment_id_input
      and movement_type = 'consumption'
  ) then
    return jsonb_build_object('status', 'already_consumed');
  end if;

  -- Соберём service_listing_ids из appointment_services. Если их нет
  -- (старые записи без позиций) — fallback на appointments.service_id.
  select array_agg(distinct s.service_listing_id)
  into service_listing_ids
  from public.appointment_services s
  where s.appointment_id = appointment_id_input
    and s.service_listing_id is not null;

  if service_listing_ids is null or array_length(service_listing_ids, 1) is null then
    -- legacy fallback: appointments.service_id ссылался на старую таблицу,
    -- но на свежих записях это всё-таки UUID из service_listings.
    if apt.service_id is not null then
      service_listing_ids := array[apt.service_id];
    else
      return jsonb_build_object('status', 'no_services');
    end if;
  end if;

  for norm in
    select n.inventory_item_id, n.amount
    from public.inventory_consumption_norms n
    where n.service_listing_id = any(service_listing_ids)
  loop
    insert into public.inventory_movements (
      inventory_item_id, movement_type, delta,
      on_hand_after, appointment_id, staff_id, notes
    ) values (
      norm.inventory_item_id,
      'consumption',
      -norm.amount,
      0, -- триггер пересчитает
      apt.id,
      apt.staff_id,
      'Auto on appointment.completed'
    );
    total_movements := total_movements + 1;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'movements', total_movements,
    'services', service_listing_ids
  );
end;
$$;

revoke all on function public.inventory_consume_for_appointment(uuid) from public;
grant execute on function public.inventory_consume_for_appointment(uuid)
  to anon, authenticated;

-- ============================================================================
-- 6. View: low-stock уведомления (для дашборда / cron)
-- ============================================================================

create or replace view public.inventory_low_stock as
  select
    i.id, i.name, i.unit, i.on_hand, i.low_stock_threshold, i.category,
    (i.low_stock_threshold - i.on_hand) as deficit
  from public.inventory_items i
  where i.is_active = true
    and i.low_stock_threshold is not null
    and i.on_hand <= i.low_stock_threshold;

-- ============================================================================
-- 7. RLS
-- ============================================================================
-- Базовая политика: чтение и запись для всех authenticated/anon, как и у
-- остальных «admin-only» таблиц. На уровне UI скрыто за RequireManage.
-- Для inventory_movements запрет UPDATE/DELETE — журнал должен быть
-- append-only (коррекция делается новым movement, не правкой старого).

alter table public.inventory_items enable row level security;
alter table public.inventory_consumption_norms enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_items_all on public.inventory_items;
create policy inventory_items_all
  on public.inventory_items
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists inventory_norms_all on public.inventory_consumption_norms;
create policy inventory_norms_all
  on public.inventory_consumption_norms
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
  on public.inventory_movements
  for select to anon, authenticated
  using (true);

drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert
  on public.inventory_movements
  for insert to anon, authenticated
  with check (true);

-- ============================================================================
-- 8. Реалтайм (Supabase publications)
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'inventory_items'
    ) then
      execute 'alter publication supabase_realtime add table public.inventory_items';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'inventory_movements'
    ) then
      execute 'alter publication supabase_realtime add table public.inventory_movements';
    end if;
  end if;
end $$;

comment on table public.inventory_items is
  'Каталог расходных материалов салона с накопленным остатком (on_hand).';
comment on table public.inventory_consumption_norms is
  'Норма расхода материала (inventory_items) на одну услугу (service_listings).';
comment on table public.inventory_movements is
  'Append-only журнал движений склада. on_hand на inventory_items — производное.';
comment on function public.inventory_consume_for_appointment(uuid) is
  'Идемпотентно списать материалы по нормам услуг для завершённой записи.';
