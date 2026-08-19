-- =============================================================================
-- External POS: provenance, idempotency and reconciliation
--
-- Shops that already run an EPOS will never switch to our till, so their sales
-- have to arrive by sync. Those sales land in the SAME `sales` table as the
-- built-in till rather than a parallel one — reports, insights and the sales
-- list should not have to know where a sale came from.
--
-- Only the API client is missing. Everything the ledger cares about is here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Where a sale came from
-- -----------------------------------------------------------------------------

alter table public.sales
  add column source text not null default 'till'
    check (source in ('till', 'epos_now')),
  -- The provider's own id for this transaction. Null for our own till.
  add column external_ref text,
  -- When the sale happened at the till, which is not when we heard about it.
  -- A sync that runs at 23:00 must not date the whole day's takings to 23:00.
  add column occurred_at timestamptz;

/*
 * The idempotency guarantee.
 *
 * Syncs get retried: a timeout, a redeploy mid-run, a manual re-sync by an
 * anxious shopkeeper. Without this index, a retry re-imports the same
 * transactions and depletes stock twice, and because stock_movements is
 * append-only the damage cannot be edited away — only a compensating movement
 * and a lot of explaining would fix it.
 *
 * The database refuses the duplicate so the application never has to be careful.
 */
create unique index sales_org_source_external_ref_key
  on public.sales (organization_id, source, external_ref)
  where external_ref is not null;

create index sales_organization_id_occurred_at_idx
  on public.sales (organization_id, occurred_at desc)
  where occurred_at is not null;

-- Backfill: every existing sale is a till sale, and happened when it was
-- created. Doing this now means occurred_at is safe to read unconditionally.
update public.sales set occurred_at = created_at where occurred_at is null;

-- -----------------------------------------------------------------------------
-- Connections
--
-- One row per connected provider per tenant. Credentials are deliberately NOT
-- stored here — they belong in a secret store, and a token in a table that
-- someone will inevitably SELECT * from is how they leak. This row holds the
-- reference and the sync bookkeeping only.
-- -----------------------------------------------------------------------------

create table public.pos_connections (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  -- Composite, per 0003: a plain reference would let one tenant point at
  -- another's location, since Postgres evaluates foreign keys with RLS bypassed.
  location_id       uuid not null,
  provider          text not null check (provider in ('epos_now')),
  status            text not null default 'disconnected'
                      check (status in ('disconnected', 'connected', 'error')),
  /** Key into the secret store. Never the token itself. */
  credential_ref    text,
  /*
   * The high-water mark: sales at or after this point may not have been seen
   * yet. Deliberately rewound a little on each sync by the caller, because a
   * provider that assigns timestamps at transaction start can make a sale
   * "appear" behind one already fetched. Re-fetching is free — the unique
   * index above throws the duplicates away.
   */
  synced_through    timestamptz,
  last_sync_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, provider, location_id),
  -- Needed before pos_unmatched_lines can reference this table compositely.
  constraint pos_connections_org_id_key unique (organization_id, id),
  constraint pos_connections_location_id_fkey
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete restrict
);

create index on public.pos_connections (organization_id, status);

-- -----------------------------------------------------------------------------
-- Unmatched lines
--
-- A barcode the EPOS sold that we have no product for. These must be KEPT, not
-- dropped: an unknown barcode is usually a product that exists in their till
-- and not in our catalogue, so this table is the shop's to-do list for closing
-- the gap — and, early on, a decent way to build the catalogue at all.
-- -----------------------------------------------------------------------------

create table public.pos_unmatched_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  connection_id     uuid,
  barcode           text not null,
  /** Whatever the provider called it. Often the only clue to what it is. */
  description       text,
  /** Running total sold while unmatched — how much stock drift this represents. */
  quantity          numeric(14,3) not null default 0,
  times_seen        integer not null default 1,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  /* Set when someone maps it. Kept rather than deleted so the history of what
     was drifting, and for how long, survives the fix. */
  resolved_product_id uuid,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, barcode),

  /*
   * Composite references, per 0003 — and per 0007, SET NULL must name the
   * column it clears. Unqualified SET NULL on a composite key nulls every
   * column in it, including organization_id, which is NOT NULL: the delete then
   * fails with a not-null violation instead of quietly clearing the reference.
   */
  constraint pos_unmatched_lines_connection_id_fkey
    foreign key (organization_id, connection_id)
    references public.pos_connections (organization_id, id)
    on delete set null (connection_id),
  constraint pos_unmatched_lines_resolved_product_id_fkey
    foreign key (organization_id, resolved_product_id)
    references public.products (organization_id, id)
    on delete set null (resolved_product_id)
);

create index pos_unmatched_open_idx
  on public.pos_unmatched_lines (organization_id, last_seen_at desc)
  where resolved_product_id is null;

-- -----------------------------------------------------------------------------
-- updated_at + RLS, same as every other tenant table
-- -----------------------------------------------------------------------------

do $mig$
declare t text;
begin
  foreach t in array array['pos_connections', 'pos_unmatched_lines']
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
