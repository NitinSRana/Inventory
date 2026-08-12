-- -----------------------------------------------------------------------------
-- Fix: ON DELETE SET NULL on a composite foreign key nulls every column in the
-- key, not just the "logical" one.
--
-- 0003 rewrote products.category_id, products.supplier_id and
-- categories.parent_id as composite (organization_id, x) foreign keys, so a row
-- can only reference something inside its own tenant. Each kept its original
-- `on delete set null`. For a multi-column key, unqualified SET NULL sets every
-- referencing column to null on delete — including organization_id, which is
-- NOT NULL on both tables. Deleting a category or a supplier a product still
-- pointed at would therefore fail with a not-null violation instead of quietly
-- clearing the reference, on a codepath nothing had exercised: products and
-- suppliers are soft-deleted (deactivated), never hard-deleted, so this FK's
-- ON DELETE branch had never actually fired before deleteCategory did.
--
-- Postgres 15+ supports naming which columns SET NULL applies to. Restricting
-- it to the one column that is actually supposed to clear is the fix — this
-- project targets Postgres 16.
-- -----------------------------------------------------------------------------

alter table public.categories drop constraint categories_parent_id_fkey;
alter table public.categories add constraint categories_parent_id_fkey
  foreign key (organization_id, parent_id) references public.categories (organization_id, id)
  on delete set null (parent_id);

alter table public.products drop constraint products_category_id_fkey;
alter table public.products add constraint products_category_id_fkey
  foreign key (organization_id, category_id) references public.categories (organization_id, id)
  on delete set null (category_id);

alter table public.products drop constraint products_supplier_id_fkey;
alter table public.products add constraint products_supplier_id_fkey
  foreign key (organization_id, supplier_id) references public.suppliers (organization_id, id)
  on delete set null (supplier_id);
