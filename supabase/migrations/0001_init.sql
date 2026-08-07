-- =============================================================================
-- Inventory Management SaaS — initial schema
-- Postgres 15+ / Supabase.  Count-driven MVP (no POS, no sales entry).
--
-- Invariants this schema enforces:
--   1. Every tenant-scoped row carries organization_id and is protected by RLS.
--   2. stock_movements is APPEND-ONLY. Quantities are derived, never stored.
--   3. Stock is addressed as (product, location, batch).
-- =============================================================================

create extension if not exists "pgcrypto";
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Tenancy helpers
-- -----------------------------------------------------------------------------

-- Resolves the caller's organization.
-- Supabase supplies auth.uid(); the GUC fallback lets migrations, background
-- jobs and tests run headless via  SET LOCAL app.current_org_id = '<uuid>'.
create or replace function app.current_org_id()
returns uuid
language plpgsql
stable
as $fn$
declare
  v_org uuid;
begin
  begin
    v_org := nullif(current_setting('app.current_org_id', true), '')::uuid;
  exception when others then
    v_org := null;
  end;

  if v_org is not null then
    return v_org;
  end if;

  begin
    select om.organization_id into v_org
    from public.organization_members om
    where om.user_id = auth.uid()
    limit 1;
  exception when others then
    v_org := null;
  end;

  return v_org;
end;
$fn$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- Blocks UPDATE/DELETE on append-only tables.
create or replace function app.prevent_mutation()
returns trigger
language plpgsql
as $fn$
begin
  raise exception
    'Table %.% is append-only; % is not permitted. Post a compensating row instead.',
    tg_table_schema, tg_table_name, tg_op;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- Organizations & membership
-- -----------------------------------------------------------------------------

create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  country_code    char(2) not null,              -- ISO 3166-1 alpha-2
  currency_code   char(3) not null default 'EUR',
  timezone        text not null default 'Europe/Berlin',
  locale          text not null default 'en',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null,                 -- FK to auth.users in Supabase
  role            text not null check (role in ('owner','manager','staff')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index on public.organization_members (user_id);

-- -----------------------------------------------------------------------------
-- Locations
-- Every tenant has exactly one location in the MVP. The table exists so that
-- multi-store chains need no migration later — only UI.
-- -----------------------------------------------------------------------------

create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  type            text not null default 'store'
                    check (type in ('store','backroom','warehouse')),
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index locations_one_default_per_org
  on public.locations (organization_id) where is_default;

-- -----------------------------------------------------------------------------
-- VAT
-- Rates are per-tenant DATA, not code. No country is hardcoded.
-- -----------------------------------------------------------------------------

create table public.vat_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  band            text not null
                    check (band in ('standard','reduced','super_reduced','zero')),
  rate            numeric(5,4) not null check (rate >= 0 and rate <= 1),
  label           text,
  valid_from      date not null default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, band, valid_from)
);

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------

create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  parent_id       uuid references public.categories(id) on delete set null,
  default_count_frequency text not null default 'monthly'
                    check (default_count_frequency in ('weekly','biweekly','monthly','quarterly')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name, parent_id)
);

-- -----------------------------------------------------------------------------
-- Suppliers
-- -----------------------------------------------------------------------------

create table public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  name              text not null,
  contact_name      text,
  email             text,
  phone             text,
  lead_time_days    integer not null default 3 check (lead_time_days >= 0),
  min_order_value   numeric(12,4),
  -- ISO weekday numbers the supplier delivers on: 1 = Monday .. 7 = Sunday
  delivery_weekdays smallint[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, name)
);

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  gtin              text,                        -- EAN-13 / EAN-8, null for loose goods
  sku               text,
  name              text not null,
  category_id       uuid references public.categories(id) on delete set null,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  unit              text not null default 'each'
                      check (unit in ('each','kg','g','l','ml')),
  -- Loose/weighed goods have no scannable barcode; the UI must handle them by
  -- search rather than scan. See spec §7 open question 4.
  is_weighed        boolean not null default false,
  cost_price        numeric(12,4),
  sell_price        numeric(12,4),
  vat_band          text not null default 'standard'
                      check (vat_band in ('standard','reduced','super_reduced','zero')),
  min_stock         numeric(14,3),
  max_stock         numeric(14,3),
  shelf_life_days   integer check (shelf_life_days >= 0),
  count_frequency   text
                      check (count_frequency in ('weekly','biweekly','monthly','quarterly')),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index products_org_gtin_uniq
  on public.products (organization_id, gtin) where gtin is not null;
create unique index products_org_sku_uniq
  on public.products (organization_id, sku) where sku is not null;
create index on public.products (organization_id, supplier_id);
create index on public.products (organization_id, category_id);
create index products_active_idx
  on public.products (organization_id) where is_active;

-- -----------------------------------------------------------------------------
-- Batches — the unit of expiry tracking
-- -----------------------------------------------------------------------------

create table public.batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  lot_number      text,
  expiry_date     date,
  received_at     timestamptz not null default now(),
  unit_cost       numeric(12,4),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Drives the expiry dashboard — the hottest read path in the product.
create index batches_expiry_idx
  on public.batches (organization_id, expiry_date)
  where expiry_date is not null;
create index on public.batches (organization_id, product_id, location_id);

-- -----------------------------------------------------------------------------
-- Stock movements — APPEND-ONLY LEDGER
-- This is the single source of truth for quantity. Never UPDATE it.
-- -----------------------------------------------------------------------------

create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  location_id     uuid not null references public.locations(id) on delete restrict,
  batch_id        uuid references public.batches(id) on delete restrict,

  -- Signed. Positive adds stock, negative removes it.
  quantity_delta  numeric(14,3) not null check (quantity_delta <> 0),

  movement_type   text not null check (movement_type in (
                    'receipt',            -- goods in
                    'waste',              -- write-off
                    'count_adjustment',   -- reconciliation from a count session
                    'manual_adjustment',  -- explicit correction by a manager
                    'consumption'         -- reserved: future POS/CSV depletion
                  )),

  -- Required for waste; free-form elsewhere.
  reason_code     text check (reason_code in (
                    'expired','damaged','theft','staff_use','sampling',
                    'supplier_return','correction','other'
                  )),

  -- Polymorphic link back to whatever caused this movement.
  reference_type  text check (reference_type in
                    ('purchase_order','count_session','manual')),
  reference_id    uuid,

  actor_id        uuid,                     -- auth.users id, null for system
  note            text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  constraint waste_requires_reason
    check (movement_type <> 'waste' or reason_code is not null),
  constraint waste_is_negative
    check (movement_type <> 'waste' or quantity_delta < 0),
  constraint receipt_is_positive
    check (movement_type <> 'receipt' or quantity_delta > 0)
);

create index on public.stock_movements (organization_id, product_id, location_id);
create index on public.stock_movements (organization_id, batch_id);
create index on public.stock_movements (organization_id, occurred_at desc);
create index on public.stock_movements (organization_id, reference_type, reference_id);

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function app.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Derived stock levels
-- security_invoker makes the view respect the caller's RLS on the base table.
-- -----------------------------------------------------------------------------

create view public.stock_levels
with (security_invoker = true) as
select
  sm.organization_id,
  sm.product_id,
  sm.location_id,
  sm.batch_id,
  sum(sm.quantity_delta)      as quantity,
  max(sm.occurred_at)         as last_movement_at
from public.stock_movements sm
group by sm.organization_id, sm.product_id, sm.location_id, sm.batch_id;

create view public.product_stock
with (security_invoker = true) as
select
  organization_id,
  product_id,
  location_id,
  sum(quantity)         as quantity,
  max(last_movement_at) as last_movement_at
from public.stock_levels
group by organization_id, product_id, location_id;

-- Expiry dashboard feed: on-hand quantity per batch, with days remaining.
create view public.expiring_stock
with (security_invoker = true) as
select
  b.organization_id,
  b.id                as batch_id,
  b.product_id,
  b.location_id,
  p.name              as product_name,
  p.gtin,
  b.lot_number,
  b.expiry_date,
  (b.expiry_date - current_date) as days_remaining,
  sl.quantity,
  coalesce(b.unit_cost, p.cost_price) as unit_cost,
  sl.quantity * coalesce(b.unit_cost, p.cost_price, 0) as value_at_risk
from public.batches b
join public.products p on p.id = b.product_id
join public.stock_levels sl on sl.batch_id = b.id
where b.expiry_date is not null
  and sl.quantity > 0;

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------

create table public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  location_id     uuid not null references public.locations(id) on delete restrict,
  po_number       text not null,
  status          text not null default 'draft' check (status in
                    ('draft','sent','partially_received','received','cancelled')),
  ordered_at      timestamptz,
  expected_at     date,
  sent_at         timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, po_number)
);

create index on public.purchase_orders (organization_id, status);
create index on public.purchase_orders (organization_id, supplier_id);

create table public.purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  quantity_ordered  numeric(14,3) not null check (quantity_ordered > 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),
  unit_cost         numeric(12,4),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (purchase_order_id, product_id)
);

create index on public.purchase_order_lines (organization_id, product_id);

-- Open (ordered but not yet received) quantity per product — feeds reorder logic
-- so it never double-orders something already on its way.
create view public.on_order_quantities
with (security_invoker = true) as
select
  pol.organization_id,
  pol.product_id,
  po.location_id,
  sum(pol.quantity_ordered - pol.quantity_received) as quantity_on_order
from public.purchase_order_lines pol
join public.purchase_orders po on po.id = pol.purchase_order_id
where po.status in ('sent','partially_received')
  and pol.quantity_ordered > pol.quantity_received
group by pol.organization_id, pol.product_id, po.location_id;

-- -----------------------------------------------------------------------------
-- Cycle counting
-- -----------------------------------------------------------------------------

create table public.count_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete restrict,
  name            text,
  scope_type      text not null default 'full'
                    check (scope_type in ('full','category','supplier','custom')),
  scope_id        uuid,                    -- category_id or supplier_id per scope_type
  status          text not null default 'in_progress'
                    check (status in ('in_progress','completed','cancelled')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  started_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.count_sessions (organization_id, status);
create index on public.count_sessions (organization_id, completed_at desc);

create table public.count_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  count_session_id  uuid not null references public.count_sessions(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  batch_id          uuid references public.batches(id) on delete restrict,
  -- Snapshot of what the ledger believed at the moment of counting.
  expected_quantity numeric(14,3),
  counted_quantity  numeric(14,3) not null check (counted_quantity >= 0),
  counted_at        timestamptz not null default now(),
  counted_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (count_session_id, product_id, batch_id)
);

create index on public.count_lines (organization_id, product_id);

-- -----------------------------------------------------------------------------
-- Consumption rates
-- Derived from count-to-count deltas. See spec §2.
--   consumption = opening count + receipts − waste − closing count
-- A null daily_rate with confidence 'insufficient' means "not enough data yet";
-- the UI must say so rather than render a misleading zero.
-- -----------------------------------------------------------------------------

create table public.consumption_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  daily_rate      numeric(14,4),
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  sample_count    integer not null default 0,   -- number of count intervals used
  confidence      text not null default 'insufficient'
                    check (confidence in ('insufficient','low','medium','high')),
  calculated_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, product_id, location_id),
  constraint period_is_ordered check (period_end > period_start)
);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

do $mig$
declare
  t text;
begin
  foreach t in array array[
    'organizations','organization_members','locations','vat_rates','categories',
    'suppliers','products','batches','purchase_orders','purchase_order_lines',
    'count_sessions','count_lines','consumption_rates'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end
$mig$;

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- Applied to every tenant-scoped table. FORCE means even the table owner is
-- subject to policy; Supabase's service_role has the BYPASSRLS attribute and is
-- unaffected, which is what you want for migrations and background jobs.
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
create policy org_isolation on public.organizations
  using (id = app.current_org_id())
  with check (id = app.current_org_id());

do $mig$
declare
  t text;
begin
  foreach t in array array[
    'organization_members','locations','vat_rates','categories','suppliers',
    'products','batches','stock_movements','purchase_orders',
    'purchase_order_lines','count_sessions','count_lines','consumption_rates'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy org_isolation on public.%I
         using (organization_id = app.current_org_id())
         with check (organization_id = app.current_org_id())', t);
  end loop;
end
$mig$;
