# CLAUDE.md

Inventory management SaaS for independent European grocery stores and small supermarkets.

## What this product does

Tells a store owner **what's about to expire** and **what to order**, without them counting anything by hand.

If a proposed feature doesn't serve that sentence, push back before building it.

**There is no POS integration and no sales entry.** Stock changes only from receiving, waste, and cycle counts. Sales are *derived*, never recorded:

```
consumption = opening count + receipts − waste − closing count
```

Do not add a "record a sale" feature. A grocery store does 300-800 transactions a day; nobody will enter them, and stale numbers are worse than no system.

Full scope and rationale: `docs/mvp-spec.md`. Read it before proposing feature work.

## The three rules

Detailed patterns and code examples are in `.claude/rules/database.md`, which loads when you touch `src/db/`, `src/server/`, or `supabase/`.

1. **Every query is tenant-scoped.** Wrap all DB access in `withTenant(orgId, ...)`. A query without org context returns zero rows. Never accept `organizationId` from the client; never use the `service_role` key in request-handling code.

2. **`stock_movements` is append-only.** A database trigger rejects UPDATE and DELETE. Correct mistakes by posting a compensating movement. Never store a quantity column — read the `stock_levels`, `product_stock`, `expiring_stock`, or `on_order_quantities` views.

3. **Stock is addressed as `(product, location, batch)`.** Every tenant has one location today; write code as if they had ten. Depletion picks batches FEFO (first-expired-first-out).

## Stack

| | |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
| Database | Postgres 16 via Supabase, EU region (Frankfurt) |
| ORM | Drizzle (`src/db/schema.ts`) |
| Auth | Supabase Auth |
| UI | Tailwind + shadcn/ui |
| Scanning | `html5-qrcode`, EAN-13/EAN-8 |
| i18n | `next-intl` |
| Email | Resend + React Email |

Data stays in the EU. Don't add a service in another region without raising it — GDPR posture is part of the sales pitch.

## Layout

```
src/
  app/[locale]/   # routes, all locale-prefixed
  db/             # schema.ts, tenant.ts
  server/         # domain logic: stock/ counting/ purchasing/ catalog/
  components/
messages/         # next-intl translations
supabase/migrations/
docs/
```

Domain logic lives in `src/server/*`, not in components or route handlers. Server actions are a thin transport layer over it.

## Conventions

- **DB:** `snake_case`, plural tables. **TS:** `camelCase`. Drizzle maps between them.
- **Money:** `numeric(12,4)`. **Quantity:** `numeric(14,3)` — weighed goods need decimals.
- Drizzle returns `numeric` as a **string**. Never parse to a JS float for arithmetic; use `decimal.js` or compute in SQL.
- **Enums:** text columns with CHECK constraints, mirrored as `as const` arrays in `schema.ts`. Adding a value means a migration *and* a schema.ts edit.
- **Timestamps:** always `timestamptz`.
- **No hardcoded VAT rates or country logic.** VAT is per-tenant rows in `vat_rates`.
- **No user-facing string literals in components.** Everything through `next-intl`, even though English is the only locale at launch.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm db:generate     # Drizzle migration from schema changes
pnpm db:migrate
pnpm db:test         # applies 0001_init.sql + 0001_init.test.sql to a scratch DB
```

`pnpm db:test` must pass before any schema change merges.

## Out of scope — ask before building

POS integration, CSV sales import, per-sale entry, Stripe billing, self-serve signup, multi-location transfer UI, demand forecasting, label printing, native mobile apps, offline mode, supplier portal, accounting integrations.

Several are planned for later. The schema already accommodates them — that's why they're safe to leave out now.

## Open questions — flag, don't invent an answer

- **Weighed/loose goods** (deli, produce) have no fixed EAN. `products.is_weighed` exists; the scanning UX is undecided.
- **Default count frequencies** — fresh weekly, ambient monthly is a placeholder, not validated with a real store.
- **Onboarding data entry** — a store facing a 2,000-SKU manual catalog build will churn in week one. Unsolved.
