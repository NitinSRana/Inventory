# CLAUDE.md

Inventory management SaaS for independent European grocery stores and small supermarkets.

## What this product does

Tells a store owner **what's about to expire**, without them counting anything by hand.

If a proposed feature doesn't serve that sentence, push back before building it.

**Stock changes from three events: receiving, cycle counts, and POS sales.** A real till records sales automatically as a side effect of ringing something up — nobody types in 300-800 transactions a day, the checkout screen does it for them. That was always the constraint; manual entry was never the plan.

There is no standalone write-off screen. A count is how loss gets found: cycle counting is a **shrinkage audit**, the gap between what the ledger says should be on the shelf (given real sales) and what's physically counted, which is theft, spoilage, or a miscount. Posting that gap corrects the ledger without needing anyone to have logged the loss as it happened. For a product with no POS sale history yet (new, or never rung up through the till), consumption falls back to the count-to-count formula:

```
consumption = opening count + receipts − waste − closing count
```

The `waste` term is a ledger read, not a live input — nothing in the product writes a `waste`-typed movement any more, so it is whatever history already exists and trends to zero for new windows. Kept rather than simplified away: existing tenant data still has real waste rows, and the formula must still account for them honestly.

Do not add manual per-sale data entry outside the checkout flow — someone typing in a till receipt after the fact is exactly the stale-numbers trap this was built to avoid.

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

Real card/payment processing (Stripe Terminal or similar — checkout v1 records tender type only, cash/card, no actual processing), accounting integrations (Xero, DATEV, Exact), partial/line-level refunds (only whole-sale void ships), self-serve signup, multi-location transfer UI, demand forecasting, label printing, native mobile apps, offline mode, supplier portal.

Several are planned for later. The schema already accommodates them — that's why they're safe to leave out now.

**Removed, not merely never built:** reorder suggestions, purchase orders, and the write-off screen were implemented, then pulled as a deliberate product decision. `stock_movements.reference_type` still allows `'purchase_order'`, `on_order_quantities` and the `waste` movement type still exist in the schema, and existing tenant data may still carry rows using them — none of that was touched. What's gone is the app-layer code that created new ones: `src/server/purchasing/*`, `recordWaste`, and the three routes. Don't rebuild any of this without confirming the decision has actually reversed.

## Open questions — flag, don't invent an answer

- **Weighed/loose goods** (deli, produce): partly answered. `products.is_weighed` is now set from the product form, and the till resolves one input two ways — a barcode if it is one, otherwise a name search — so loose goods can be rung up by name and priced per kg. **Still undecided: scale-printed barcodes.** A counter scale prints an EAN-13 in the GS1 restricted range (prefix `02`/`2x`) encoding an item number plus either a weight or a price, and the layout is a per-country, per-scale-vendor convention with no single standard. Decoding it wrong sells a €40 cheese for €4. Needs a real scale and a real store before anyone writes that parser.
- **Default count frequencies** — fresh weekly, ambient monthly is a placeholder, not validated with a real store.
- **Onboarding data entry** — a store facing a 2,000-SKU manual catalog build will churn in week one. Unsolved.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
