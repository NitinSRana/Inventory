---
paths:
  - "src/db/**"
  - "src/server/**"
  - "supabase/**"
---

# Database rules

These are not style preferences. Breaking them causes data corruption or cross-tenant data leaks.

## 1. Tenant scoping

Every tenant table has `organization_id` and is protected by Postgres RLS with `FORCE`. The policy calls `app.current_org_id()`.

Every request must open a transaction and set the org context:

```ts
// src/db/tenant.ts
export async function withTenant<T>(
  orgId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) = transaction-scoped, so it cannot leak across
    // requests sharing a pooled connection. The `true` is load-bearing.
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
```

```ts
// Correct
const items = await withTenant(orgId, (tx) =>
  tx.select().from(products).where(eq(products.isActive, true)));

// Wrong - no org context. Returns zero rows, and you will waste an hour on it.
const items = await db.select().from(products);
```

**Never use the Supabase `service_role` key in request-handling code.** It has `BYPASSRLS`; one accidental use and tenant isolation is gone. It belongs only in migrations and trusted background jobs.

**Never accept `organizationId` from the client.** Derive it server-side from the session.

## 2. The append-only ledger

`stock_movements` is the single source of truth for quantity. A trigger rejects `UPDATE` and `DELETE`.

```ts
// Wrong - the database will throw.
await tx.update(stockMovements).set({ quantityDelta: '5' }).where(...);

// Correct - post a compensating movement.
await tx.insert(stockMovements).values({
  organizationId, productId, locationId, batchId,
  quantityDelta: '-5',
  movementType: 'manual_adjustment',
  reasonCode: 'correction',
  note: 'Reverses movement abc-123: miscounted at receipt',
});
```

**Never store a quantity column anywhere.** Read from the views:

| View | Gives you |
|---|---|
| `stock_levels` | Quantity per (product, location, batch) |
| `product_stock` | Quantity per (product, location), batches summed |
| `expiring_stock` | On-hand batches with expiry, days remaining, value at risk |
| `on_order_quantities` | Open PO quantity per product - so reorder logic does not double-order |

If a query is slow, add an index or a materialized view. Do not denormalize into a mutable counter.

Constraints the DB already enforces, so you do not need to re-check them in application code: waste must be negative, waste requires a `reason_code`, receipts must be positive, `quantity_delta` can never be zero.

## 3. Numeric handling

Drizzle returns `numeric` columns as **strings**. Never `parseFloat` them for arithmetic - float arithmetic on money is a bug. Use `decimal.js`, or do the arithmetic in SQL.

Money is `numeric(12,4)`. Quantity is `numeric(14,3)` because weighed goods need decimals.

## 4. Changing the schema

1. Write the SQL migration by hand in `supabase/migrations/`. **Never edit an applied migration.**
2. Update `src/db/schema.ts` to match. The SQL is authoritative; schema.ts exists for type-safe queries and does not express RLS or triggers.
3. If the new table is tenant-scoped, add it to the RLS loop at the bottom of the migration. **A tenant table without RLS is a data breach waiting to happen - this is the easiest mistake to make in this codebase.**
4. Add an isolation check for it to `supabase/migrations/0001_init.test.sql`.
5. Run `pnpm db:test`.

## 5. Testing RLS

`0001_init.test.sql` runs its isolation checks as a **non-superuser** role, and this is essential. Superusers bypass RLS entirely, so a suite that tests as `postgres` passes even when every policy has been deleted. If you add tests, keep them under `set role app_user`.
