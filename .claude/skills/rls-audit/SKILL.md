---
name: rls-audit
description: Audit the codebase for tenant-isolation gaps - tables missing RLS, queries bypassing withTenant, service_role usage in request paths, and ledger mutations. Run before every merge that touches the database or server layer.
---

# Tenant isolation audit

The one unrecoverable failure in this product is showing one store another store's data. Everything else can be fixed with a migration. This cannot be fixed after it happens.

Work through all five checks. Report findings as a table with file, line, severity, and fix. If everything passes, say so plainly — do not invent problems.

## 1. Tables without RLS

For every table in `supabase/migrations/`:

- Does it have an `organization_id` column? (Exceptions: none currently. A new exception must be justified out loud.)
- Is it in the RLS loop at the bottom of the migration?
- Does it have both `enable row level security` AND `force row level security`?

A tenant table missing from that loop is a **critical** finding.

## 2. Queries bypassing tenant scope

Search `src/server/` and `src/app/` for database access:

- Every query must run inside `withTenant(orgId, ...)`.
- Flag any direct `db.select(`, `db.insert(`, `db.update(`, `db.delete(` that isn't inside a `withTenant` callback.
- Flag any `tx.execute(sql\`...\`)` with raw SQL that doesn't filter by organization.

## 3. service_role leakage

- `SUPABASE_SERVICE_ROLE_KEY` must appear only in migration scripts and explicitly-marked background jobs.
- Any reference inside `src/app/`, a server action, or a route handler is **critical** — that key has BYPASSRLS and voids every policy in the database.

## 4. Client-supplied organization IDs

- `organizationId` must never be read from a request body, query string, form field, or route param.
- It is derived server-side from the session. Every time.
- A function signature like `doThing(orgId: string, ...)` called from a route handler is fine only if the caller sources `orgId` from the session.

## 5. Ledger mutations

- No `UPDATE` or `DELETE` against `stock_movements` anywhere.
- No stored quantity columns. Quantities come from `stock_levels`, `product_stock`, `expiring_stock`, `on_order_quantities`.
- Corrections must be compensating inserts.

## Then verify

Run `pnpm db:test` and report the result. If new tables were added without a corresponding isolation check in `0001_init.test.sql`, say so — a passing suite that doesn't cover the new table is worse than no suite, because it reads as green.
