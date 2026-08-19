# External POS integration — the shell

Everything except the HTTP calls. When EposNow credentials arrive, four `TODO`s in one file stand between this and a live integration.

## Why it's shaped this way

A shop already running an EPOS will never switch to our till. So there are two customers, not one:

- **Has an EPOS** → sales arrive by sync. Their till is the source of truth for money.
- **Has no EPOS** → `/checkout` is a real differentiator, and inventory-with-a-till beats inventory alone.

`/checkout` is not being replaced. External sales land in the **same `sales` table** as till sales, so reports, insights and any future sales list work for both without knowing the difference.

## The pieces

| File | What it is |
|---|---|
| `sources/types.ts` | `ExternalSale`, `SalesSource`, `SyncResult` — the provider-agnostic contract |
| `sources/fixture.ts` | In-memory source. The whole pipeline is tested against this |
| `sources/epos-now.ts` | **Stub.** Four TODOs, all HTTP |
| `sync.ts` | The pipeline: idempotency, matching, FEFO depletion, reconciliation |
| `sync.itest.ts` | 13 integration tests, none needing an API |
| `0011_external_pos.sql` | `sales.source` / `external_ref` / `occurred_at`, `pos_connections`, `pos_unmatched_lines` |

Adding a second EPOS later is one adapter, not a second pipeline.

## Four decisions that are load-bearing

### 1. Idempotency lives in the database

A unique index on `(organization_id, source, external_ref)` — partial, so our own till's null refs don't collide.

Syncs get retried: timeouts, redeploys mid-run, an anxious shopkeeper pressing the button twice. Without this, a retry re-imports the day and depletes stock twice — and because `stock_movements` is append-only, that damage can't be edited away, only compensated for and explained.

The application also checks before inserting, but that check is an optimisation. **The index is the guarantee**, so correctness never depends on the caller being careful. Verified against Postgres 16.

Consequently `externalRef` must be *stable*. If EposNow's transaction id is stable, use it. If not, synthesise something deterministic from immutable fields — never a uuid, timestamp or array index, each of which re-imports everything on the next run.

### 2. An external sale cannot be refused

Our till throws `InsufficientStockError` when stock is short. That's right when the customer is standing there.

An external sale already happened — money taken, goods gone. Refusing it would leave the ledger claiming stock that isn't on the shelf. So `allocateFefoPartial()` takes what exists, earliest expiry first, and posts the remainder as a batch-less movement. On-hand goes **negative**, which is a true signal that a delivery was never recorded, rather than a comfortable lie in the other direction.

### 3. Money is computed exactly as `checkout.ts` computes it

Line prices come from the provider when given — a promotion at their till is a real price a real customer paid — and fall back to our `sellPrice`. VAT is then *extracted* from that gross figure using our own bands, so `subtotal + vatTotal === total` holds for every row in `sales` regardless of origin.

If their reported total disagrees with ours, ours is stored (it's internally consistent and reconcilable) and the discrepancy is logged. A persistent gap usually means unmatched lines or a promotion we can't see, and it should be visible rather than absorbed.

### 4. Nothing is dropped

An unknown barcode goes to `pos_unmatched_lines`, upserted with a running quantity and a `times_seen` count. Forty rows for one missing product would bury the signal; one row showing how much drift it represents is what decides whether it matters.

This queue is also the **cold-start solution for EPOS shops** — it's a ranked list of exactly which products are missing from the catalogue, ordered by how much stock they're quietly costing.

## What's deliberately not built

- **Refunds.** `sync.ts` rejects them loudly rather than guessing. A refund recorded as a sale depletes stock for goods that are coming back. Wire it up when you can see the real payload.
- **Credential storage.** `pos_connections.credential_ref` is a key into a secret store. Do not put a token in that table — it's the kind of column someone eventually `SELECT *`s into a log.
- **A settings screen** to connect an account, and a reconciliation screen for the unmatched queue. Both are UI over functions that already exist.
- **Scheduling.** `syncFromSource()` is the whole entry point; a cron route or a job runner calls it.

## Verified

- All 11 migrations apply cleanly to Postgres 16, in order.
- The idempotency index refuses a duplicate `external_ref`, and permits two till sales with null refs.
- The composite FK refuses a connection pointing at another tenant's location.
- `ON DELETE SET NULL` clears `connection_id` only, leaving `organization_id` intact — the 0007 trap.
- `allocateFefoPartial` verified standalone: expiry ordering, full shortfall, partial shortfall, negative on-hand, 3dp weighed goods.
- `windowSince` verified.

**Not verified:** `sync.itest.ts` has not been run — pnpm's Windows symlinks don't resolve in the Linux sandbox. Run `pnpm db:migrate && pnpm test:integration` before trusting any of it.

## Finishing it

1. **Email EposNow for API access now.** 4-8 weeks typical, and it blocks nothing else.
2. Fill the four TODOs in `sources/epos-now.ts`.
3. Point `sync.itest.ts` at the real adapter with a recorded fixture payload.
4. Build the connect screen and the unmatched queue.

When mapping their payload, verify whether prices are gross or net **against a real receipt**, not against the docs. Getting that backwards is precisely the bug that reached the first demo.
