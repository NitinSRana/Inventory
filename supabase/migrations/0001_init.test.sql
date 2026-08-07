-- =============================================================================
-- Verification suite for 0001_init.sql
--
-- Run against a scratch database AFTER applying the migration:
--     psql -v ON_ERROR_STOP=1 -f 0001_init.sql -f 0001_init.test.sql
--
-- Every check raises an exception on failure, so a clean run means all passed.
-- Keep this in the repo and run it in CI — RLS regressions are silent and
-- catastrophic in a multi-tenant product.
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- A non-superuser role. This matters: superusers bypass RLS entirely, so
-- testing isolation as `postgres` would pass no matter how broken the policies
-- are. This is the single most common way RLS test suites lie to you.
-- -----------------------------------------------------------------------------

drop role if exists app_user;
create role app_user nologin;
grant usage on schema public, app to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema app to app_user;

-- -----------------------------------------------------------------------------
-- Seed two tenants (as superuser, bypassing RLS)
-- -----------------------------------------------------------------------------

insert into public.organizations (id, name, country_code, currency_code) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alpha Markt',  'DE', 'EUR'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beta Super',   'NL', 'EUR');

insert into public.locations (id, organization_id, name, is_default) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alpha Store', true),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beta Store',  true);

insert into public.suppliers (id, organization_id, name, lead_time_days) values
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Molkerei Nord', 2),
  ('b0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bakkerij Zuid', 1);

insert into public.products (id, organization_id, gtin, name, unit, cost_price, sell_price, vat_band, min_stock, shelf_life_days, supplier_id) values
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '4001234567890', 'Vollmilch 1L', 'each', 0.80, 1.29, 'reduced', 40, 10, 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '8712345678901', 'Volkorenbrood', 'each', 0.95, 2.10, 'reduced', 20,  3, 'b0000000-0000-0000-0000-000000000002');

insert into public.batches (id, organization_id, product_id, location_id, lot_number, expiry_date, unit_cost) values
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'LOT-A1', current_date + 5, 0.80);

-- Receive 100, bin 10 as expired -> expect 90 on hand.
insert into public.stock_movements
  (organization_id, product_id, location_id, batch_id, quantity_delta, movement_type, reason_code, reference_type)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004',  100, 'receipt', null,      'manual'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004',  -10, 'waste',   'expired', 'manual');

-- An open PO for 60 more.
insert into public.purchase_orders (id, organization_id, supplier_id, location_id, po_number, status)
values ('a0000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'PO-0001', 'sent');

insert into public.purchase_order_lines (organization_id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 60, 10, 0.78);

-- =============================================================================
-- Checks
-- =============================================================================

do $t$
declare
  n        integer;
  q        numeric;
  v        numeric;
  failed   boolean;
begin
  ----------------------------------------------------------------------------
  raise notice '--- ledger arithmetic (as superuser) ---';

  select quantity into q from public.stock_levels
   where batch_id = 'a0000000-0000-0000-0000-000000000004';
  if q is distinct from 90 then
    raise exception 'FAIL stock_levels: expected 90, got %', q;
  end if;
  raise notice 'PASS  stock_levels derives 90 from +100 / -10';

  select quantity into q from public.product_stock
   where product_id = 'a0000000-0000-0000-0000-000000000003';
  if q is distinct from 90 then
    raise exception 'FAIL product_stock: expected 90, got %', q;
  end if;
  raise notice 'PASS  product_stock aggregates batches';

  select quantity, value_at_risk into q, v from public.expiring_stock
   where batch_id = 'a0000000-0000-0000-0000-000000000004';
  if q is distinct from 90 or v is distinct from 72.00 then
    raise exception 'FAIL expiring_stock: expected 90 / 72.00, got % / %', q, v;
  end if;
  raise notice 'PASS  expiring_stock value_at_risk = 72.00';

  select quantity_on_order into q from public.on_order_quantities
   where product_id = 'a0000000-0000-0000-0000-000000000003';
  if q is distinct from 50 then
    raise exception 'FAIL on_order_quantities: expected 50, got %', q;
  end if;
  raise notice 'PASS  on_order_quantities = 50 (60 ordered - 10 received)';

  ----------------------------------------------------------------------------
  raise notice '--- append-only ledger ---';

  failed := false;
  begin
    update public.stock_movements set quantity_delta = 999
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL append-only: UPDATE on stock_movements was allowed';
  end if;
  raise notice 'PASS  UPDATE on stock_movements blocked';

  failed := false;
  begin
    delete from public.stock_movements
     where organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL append-only: DELETE on stock_movements was allowed';
  end if;
  raise notice 'PASS  DELETE on stock_movements blocked';

  ----------------------------------------------------------------------------
  raise notice '--- movement constraints ---';

  failed := false;
  begin
    insert into public.stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reason_code)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003',
            'a0000000-0000-0000-0000-000000000001', 5, 'waste', 'expired');
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: positive-quantity waste was accepted';
  end if;
  raise notice 'PASS  waste must be negative';

  failed := false;
  begin
    insert into public.stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003',
            'a0000000-0000-0000-0000-000000000001', -5, 'waste');
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: waste without a reason_code was accepted';
  end if;
  raise notice 'PASS  waste requires a reason_code';

  failed := false;
  begin
    insert into public.stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003',
            'a0000000-0000-0000-0000-000000000001', 0, 'manual_adjustment');
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: zero-quantity movement was accepted';
  end if;
  raise notice 'PASS  zero-quantity movements rejected';
end
$t$;

-- -----------------------------------------------------------------------------
-- RLS isolation — must run as a NON-superuser
-- -----------------------------------------------------------------------------

set role app_user;

do $t$
declare
  n      integer;
  nm     text;
  failed boolean;
begin
  raise notice '--- RLS isolation (role=%) ---', current_user;

  -- Tenant A context
  perform set_config('app.current_org_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

  select count(*) into n from public.products;
  if n <> 1 then raise exception 'FAIL: org A sees % products, expected 1', n; end if;
  select name into nm from public.products;
  if nm <> 'Vollmilch 1L' then raise exception 'FAIL: org A sees wrong product: %', nm; end if;
  raise notice 'PASS  org A sees only its own product';

  select count(*) into n from public.organizations;
  if n <> 1 then raise exception 'FAIL: org A sees % organizations, expected 1', n; end if;
  raise notice 'PASS  organizations table isolated';

  select count(*) into n from public.stock_levels;
  if n <> 1 then raise exception 'FAIL: org A sees % stock_levels rows, expected 1', n; end if;
  raise notice 'PASS  views inherit RLS (security_invoker works)';

  -- Tenant B context
  perform set_config('app.current_org_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

  select count(*) into n from public.products;
  if n <> 1 then raise exception 'FAIL: org B sees % products, expected 1', n; end if;
  select name into nm from public.products;
  if nm <> 'Volkorenbrood' then raise exception 'FAIL: org B sees wrong product: %', nm; end if;
  raise notice 'PASS  org B sees only its own product';

  select count(*) into n from public.stock_levels;
  if n <> 0 then raise exception 'FAIL: org B sees % stock rows, expected 0', n; end if;
  raise notice 'PASS  org B sees none of org A''s stock';

  -- Cross-tenant write must be refused by WITH CHECK
  failed := false;
  begin
    insert into public.products (organization_id, name, gtin)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Smuggled Item', '9999999999999');
  exception when others then failed := true;
  end;
  if not failed then
    raise exception 'FAIL: org B inserted a row into org A';
  end if;
  raise notice 'PASS  cross-tenant INSERT blocked by WITH CHECK';

  -- No context at all -> no rows, and no crash from the missing auth.uid()
  perform set_config('app.current_org_id', '', true);
  select count(*) into n from public.products;
  if n <> 0 then raise exception 'FAIL: unscoped session sees % products, expected 0', n; end if;
  raise notice 'PASS  session with no org context sees nothing';
end
$t$;

reset role;

\echo ''
\echo '========================================='
\echo ' All schema checks passed.'
\echo '========================================='
