-- -----------------------------------------------------------------------------
-- POS checkout.
--
-- A till recording a sale as a side effect of ringing something up — not
-- someone typing one in after the fact. Depletes stock through the same
-- ledger every other movement uses; 'consumption' has been reserved on
-- stock_movements.movement_type since 0001 for exactly this.
--
-- Modeled on purchase_orders/purchase_order_lines: a parent with a status
-- enum and a unique per-org number, a child line table. Composite foreign
-- keys are declared inline from the start here, rather than added in a
-- follow-up migration the way 0003 had to for tables that predated the
-- tenant-scoped-FK fix — there is no earlier single-column version to correct.
-- -----------------------------------------------------------------------------

create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete restrict,
  sale_number     text not null,
  status          text not null default 'completed' check (status in ('completed', 'voided')),
  subtotal        numeric(12,4) not null check (subtotal >= 0),
  vat_total       numeric(12,4) not null check (vat_total >= 0),
  total           numeric(12,4) not null check (total >= 0),
  tender_type     text not null check (tender_type in ('cash', 'card')),
  sold_by         uuid,
  voided_at       timestamptz,
  voided_by       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, sale_number),
  -- Needed so sale_lines can reference this row compositely, same as every
  -- other tenant-scoped parent (see 0003).
  unique (organization_id, id)
);

create index on public.sales (organization_id, status);
create index on public.sales (organization_id, created_at desc);

create table public.sale_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id         uuid not null,
  product_id      uuid not null,
  quantity        numeric(14,3) not null check (quantity > 0),
  unit_price      numeric(12,4) not null,
  vat_band        text not null check (vat_band in ('standard', 'reduced', 'super_reduced', 'zero')),
  vat_amount      numeric(12,4) not null check (vat_amount >= 0),
  line_total      numeric(12,4) not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (organization_id, sale_id) references public.sales (organization_id, id) on delete cascade,
  foreign key (organization_id, product_id) references public.products (organization_id, id) on delete restrict,
  -- Repeat-scanning the same product increments one line's quantity rather
  -- than creating a second line for it, mirroring purchase_order_lines.
  unique (sale_id, product_id)
);

create index on public.sale_lines (organization_id, product_id);

-- -----------------------------------------------------------------------------
-- stock_movements: a sale is a new reference_type, and 'consumption' needs the
-- same directional guarantee 'waste' already has.
-- -----------------------------------------------------------------------------

alter table public.stock_movements drop constraint stock_movements_reference_type_check;
alter table public.stock_movements add constraint stock_movements_reference_type_check
  check (reference_type in ('purchase_order', 'count_session', 'manual', 'sale'));

alter table public.stock_movements add constraint consumption_is_negative
  check (movement_type <> 'consumption' or quantity_delta < 0);

-- -----------------------------------------------------------------------------
-- updated_at triggers and RLS — the two places a new tenant table must be
-- added, or it silently has no row-level security at all.
-- -----------------------------------------------------------------------------

do $mig$
declare
  t text;
begin
  foreach t in array array['sales', 'sale_lines']
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function app.touch_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format(
      'create policy org_isolation on public.%I
         using (organization_id = app.current_org_id())
         with check (organization_id = app.current_org_id())', t);
  end loop;
end
$mig$;
