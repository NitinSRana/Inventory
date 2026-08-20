-- =============================================================================
-- Use-by vs best-before
--
-- One expiry_date column has done two legally distinct jobs: selling past a
-- use-by date is a criminal offence in the UK, past best-before is routine and
-- shops mark it down. This adds the classification without disrupting a live
-- shop's existing catalogue.
--
-- Existing rows land on 'best_before' (today's behaviour: nothing is blocked)
-- rather than 'use_by' (which would make the till start refusing sales on
-- ambient stock the instant this ships, with no human review). New products
-- default to the stricter 'use_by' going forward. Same two-step technique as
-- 0010_uk_vat_defaults.sql's vat_band default change.
-- =============================================================================

alter table public.products
  add column date_type text not null default 'best_before'
    check (date_type in ('use_by', 'best_before'));

alter table public.products
  alter column date_type set default 'use_by';

-- batches.date_type is always supplied explicitly by the app, copied from the
-- product at receive time — no second-step default needed.
alter table public.batches
  add column date_type text not null default 'best_before'
    check (date_type in ('use_by', 'best_before'));

-- expiring_stock needs the classification so the dashboard can tell a hard
-- stop from a markdown prompt. Appended at the end: CREATE OR REPLACE VIEW
-- cannot reorder or retype existing columns.
create or replace view public.expiring_stock
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
  sl.quantity * coalesce(b.unit_cost, p.cost_price, 0) as value_at_risk,
  b.date_type
from public.batches b
join public.products p on p.id = b.product_id
join public.stock_levels sl on sl.batch_id = b.id
where b.expiry_date is not null
  and sl.quantity > 0;
