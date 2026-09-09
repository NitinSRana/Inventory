-- -----------------------------------------------------------------------------
-- An index the sales list can actually use.
--
-- The list orders by, and now filters on, when a sale *happened* —
-- coalesce(occurred_at, created_at) — because a sale synced from an external
-- till carries the time it was rung up at their end, not the time this database
-- heard about it. `sales_organization_id_created_at_idx` cannot serve that: an
-- expression is not the column it wraps, so Postgres falls back to a sort of
-- the whole tenant's sales.
--
-- Matters at 300-800 transactions a day. At a year of trading that is a
-- six-figure row count behind a screen someone opens to find one receipt.
--
-- No RLS entry needed: this indexes an existing table whose policy is already
-- in place, and adds no new object to protect.
-- -----------------------------------------------------------------------------

create index sales_organization_id_occurred_idx
  on public.sales (organization_id, (coalesce(occurred_at, created_at)) desc);
