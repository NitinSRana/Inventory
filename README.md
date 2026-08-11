# Inventory

Inventory management for independent European grocery stores.

Tells a shop owner **what's about to expire** and **what to order**, without them
counting anything by hand.

There is no POS integration and no sales entry. Stock changes only from
receiving, waste and cycle counts; consumption is derived:

```
consumption = opening count + receipts − waste − closing count
```

Scope and rationale: [`docs/mvp-spec.md`](docs/mvp-spec.md).
Working rules for this codebase: [`CLAUDE.md`](CLAUDE.md).

## Running it

Requires Node 22.6+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # fill in the three Supabase values
pnpm db:migrate              # apply migrations
pnpm seed you@example.com    # a demo shop with two weeks of history
pnpm dev
```

Then sign in at `/en/sign-in` with that email — the link arrives by mail, there
is no password.

`pnpm seed` builds a shop with 18 products, batches across every expiry band,
two completed count cycles (so consumption rates exist), some waste and an open
purchase order. It runs through the real server layer, so the data is data the
app could have produced.

Adopting a database that was migrated by hand:

```bash
pnpm db:migrate --baseline   # record migrations as applied without running them
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test               # 65 unit tests, pure logic
pnpm test:integration   # 40 tests against a real Postgres
pnpm db:test            # 19 schema, RLS and ledger checks
pnpm test:all           # all three
```

The last three **start their own throwaway Postgres** — no Docker, no
credentials, no local server to set up. That is deliberate: a gate that needs
credentials is a gate nobody runs, and these are the ones that prove tenant
isolation holds.

### End to end

```bash
pnpm test:e2e --project=public   # signed-out routing, no credentials needed
pnpm test:e2e                    # the five daily-loop flows
```

These drive a real browser against `pnpm dev` and assert on **behaviour and
data**: role and label selectors going in, the `stock_movements` ledger coming
back out. A screen that says "Delivery recorded" while writing nothing fails
here. Nothing asserts on markup, so the visual rebuild cannot break them.

The full run needs a seeded `Demo Grocer` (`pnpm seed <email>`) and
`ADMIN_DATABASE_URL`, which is how the suite mints a one-time sign-in token
instead of waiting on an inbox. The `public` project needs neither.

## How it is put together

| | |
|---|---|
| Framework | Next.js 16, App Router, TypeScript strict |
| Database | Postgres via Supabase, EU region |
| ORM | Drizzle — `src/db/schema.ts` |
| Auth | Supabase Auth, magic link only |
| UI | Tailwind v4 + shadcn/ui |
| i18n | next-intl, English at launch, every URL locale-prefixed |

```
src/
  app/[locale]/(app)/   signed-in screens, wrapped in the shell
  app/[locale]/sign-in  outside the shell — no org yet
  server/               domain logic: catalog stock counting consumption purchasing
  db/                   schema.ts, tenant.ts
supabase/migrations/    hand-written SQL, applied in order
scripts/                seed, migrate, test harnesses
```

Domain logic lives in `src/server/*`. Pages and server actions are a thin
transport layer over it.

## Three rules that are not style preferences

**Every query is tenant-scoped.** All database access goes through
`withTenant(orgId, …)`. The Drizzle client is deliberately not exported, so a
query without org context is unwritable rather than merely discouraged. The app
connects as `app_runtime`, which is `NOBYPASSRLS` — connecting as `postgres`
would silently disable every policy.

**`stock_movements` is append-only.** A trigger rejects UPDATE and DELETE.
Mistakes are corrected by posting a compensating movement. No quantity is ever
stored — it is summed from the ledger by the `stock_levels`, `product_stock`,
`expiring_stock` and `on_order_quantities` views.

**Stock is addressed as (product, location, batch).** Depletion picks batches
first-expired-first-out. Every tenant has one location today; the schema assumes
they will have ten.

## Known gaps

- Purchase orders cannot be emailed to suppliers yet — needs a mail provider.
- An organization cannot be deleted once it has ledger rows, because the
  append-only trigger blocks the cascade. That is a GDPR erasure question with
  no answer yet.
- Weighed goods (`products.is_weighed`) have no scanning UX.
- Supabase's built-in SMTP is rate limited; a pilot needs a real mail provider.
