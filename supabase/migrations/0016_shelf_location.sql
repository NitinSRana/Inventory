-- Where a product sits in the shop: "Fridge Row 2", "Aisle 3, Shelf C".
--
-- From the Figma redesign (7P9p7x0R2wp9CqKLruUHrr): the expiry dashboard's
-- LOCATION column, the scan result's SHELF LOCATION, and a count scoped to
-- "Dairy & chilled — Chiller shelf 3". It reverses the earlier position that a
-- shop needs no finer address than its one location — a decision the owner
-- took explicitly, and recorded in CLAUDE.md.
--
-- Free text on the product, not a table. A shelf name is how staff already talk
-- ("the chiller by the door"), there is nothing to join or validate it against,
-- and a product lives on one shelf, so its batches inherit it. `locations`
-- (store / backroom / warehouse) is untouched, so stock is still addressed as
-- (product, location, batch).
--
-- No RLS changes: both tables already carry the policy and FORCE from
-- 0001_init.sql, and a new column on an existing table inherits both.

alter table products add column shelf_location text;
alter table count_sessions add column shelf_location text;

comment on column products.shelf_location is
  'Where it sits in the shop, as staff name it. Batches inherit it.';
comment on column count_sessions.shelf_location is
  'The shelf this count covers, when narrower than its category.';
