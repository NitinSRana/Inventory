-- -----------------------------------------------------------------------------
-- Tenant-scoped foreign keys.
--
-- RLS stops one tenant READING another's rows, but it does not stop one
-- REFERENCING them: Postgres evaluates foreign keys as the table owner, with
-- policies bypassed. So org A could post a stock_movement carrying its own
-- organization_id while pointing product_id at org B's product. Nothing leaks —
-- A still cannot read that product — but A's ledger ends up holding a row it
-- cannot resolve, which stock_levels counts and expiring_stock silently drops
-- on the join. Phantom stock, invisible cause.
--
-- The fix is to make organization_id part of every reference, so a row can only
-- point at rows inside its own tenant. Verified by 0001_init.test.sql.
-- -----------------------------------------------------------------------------

-- Targets of tenant-scoped references need (organization_id, id) to be unique
-- before it can be referenced. id is already the primary key, so this adds no
-- real constraint — only the index a composite foreign key requires.
alter table public.categories      add constraint categories_org_id_key      unique (organization_id, id);
alter table public.suppliers       add constraint suppliers_org_id_key       unique (organization_id, id);
alter table public.locations       add constraint locations_org_id_key       unique (organization_id, id);
alter table public.products        add constraint products_org_id_key        unique (organization_id, id);
alter table public.batches         add constraint batches_org_id_key         unique (organization_id, id);
alter table public.purchase_orders add constraint purchase_orders_org_id_key unique (organization_id, id);
alter table public.count_sessions  add constraint count_sessions_org_id_key  unique (organization_id, id);

-- categories.parent_id
alter table public.categories drop constraint categories_parent_id_fkey;
alter table public.categories add constraint categories_parent_id_fkey
  foreign key (organization_id, parent_id) references public.categories (organization_id, id)
  on delete set null;

-- products.category_id, products.supplier_id
alter table public.products drop constraint products_category_id_fkey;
alter table public.products add constraint products_category_id_fkey
  foreign key (organization_id, category_id) references public.categories (organization_id, id)
  on delete set null;

alter table public.products drop constraint products_supplier_id_fkey;
alter table public.products add constraint products_supplier_id_fkey
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id)
  on delete set null;

-- batches.product_id, batches.location_id
alter table public.batches drop constraint batches_product_id_fkey;
alter table public.batches add constraint batches_product_id_fkey
  foreign key (organization_id, product_id) references public.products (organization_id, id)
  on delete cascade;

alter table public.batches drop constraint batches_location_id_fkey;
alter table public.batches add constraint batches_location_id_fkey
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
  on delete cascade;

-- stock_movements: the ledger. This is the one that matters most.
alter table public.stock_movements drop constraint stock_movements_product_id_fkey;
alter table public.stock_movements add constraint stock_movements_product_id_fkey
  foreign key (organization_id, product_id) references public.products (organization_id, id)
  on delete restrict;

alter table public.stock_movements drop constraint stock_movements_location_id_fkey;
alter table public.stock_movements add constraint stock_movements_location_id_fkey
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
  on delete restrict;

alter table public.stock_movements drop constraint stock_movements_batch_id_fkey;
alter table public.stock_movements add constraint stock_movements_batch_id_fkey
  foreign key (organization_id, batch_id) references public.batches (organization_id, id)
  on delete restrict;

-- purchase_orders
alter table public.purchase_orders drop constraint purchase_orders_supplier_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_supplier_id_fkey
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id)
  on delete restrict;

alter table public.purchase_orders drop constraint purchase_orders_location_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_location_id_fkey
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
  on delete restrict;

-- purchase_order_lines
alter table public.purchase_order_lines drop constraint purchase_order_lines_purchase_order_id_fkey;
alter table public.purchase_order_lines add constraint purchase_order_lines_purchase_order_id_fkey
  foreign key (organization_id, purchase_order_id) references public.purchase_orders (organization_id, id)
  on delete cascade;

alter table public.purchase_order_lines drop constraint purchase_order_lines_product_id_fkey;
alter table public.purchase_order_lines add constraint purchase_order_lines_product_id_fkey
  foreign key (organization_id, product_id) references public.products (organization_id, id)
  on delete restrict;

-- count_sessions.location_id
alter table public.count_sessions drop constraint count_sessions_location_id_fkey;
alter table public.count_sessions add constraint count_sessions_location_id_fkey
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
  on delete restrict;

-- count_lines
alter table public.count_lines drop constraint count_lines_count_session_id_fkey;
alter table public.count_lines add constraint count_lines_count_session_id_fkey
  foreign key (organization_id, count_session_id) references public.count_sessions (organization_id, id)
  on delete cascade;

alter table public.count_lines drop constraint count_lines_product_id_fkey;
alter table public.count_lines add constraint count_lines_product_id_fkey
  foreign key (organization_id, product_id) references public.products (organization_id, id)
  on delete restrict;

alter table public.count_lines drop constraint count_lines_batch_id_fkey;
alter table public.count_lines add constraint count_lines_batch_id_fkey
  foreign key (organization_id, batch_id) references public.batches (organization_id, id)
  on delete restrict;

-- consumption_rates
alter table public.consumption_rates drop constraint consumption_rates_product_id_fkey;
alter table public.consumption_rates add constraint consumption_rates_product_id_fkey
  foreign key (organization_id, product_id) references public.products (organization_id, id)
  on delete cascade;

alter table public.consumption_rates drop constraint consumption_rates_location_id_fkey;
alter table public.consumption_rates add constraint consumption_rates_location_id_fkey
  foreign key (organization_id, location_id) references public.locations (organization_id, id)
  on delete cascade;
