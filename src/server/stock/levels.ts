import { and, asc, desc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';

import { batches, expiringStock, productStock, stockLevels } from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';

import type { BatchStock } from './fefo';

/**
 * Reads only. Quantity is never stored — it is summed from the append-only
 * ledger by these views, so there is no counter to drift out of sync.
 */

/** On-hand per (product, location), batches summed. */
export async function getProductStock(orgId: string, productId?: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select()
      .from(productStock)
      .where(productId ? eq(productStock.productId, productId) : undefined)
      .orderBy(desc(productStock.lastMovementAt)),
  );
}

/**
 * On-hand per batch, ordered for FEFO. Joined to batches for the expiry date,
 * which stock_levels does not carry.
 */
export async function getBatchStock(
  orgId: string,
  productId: string,
  locationId: string,
  tx?: Tx,
): Promise<BatchStock[]> {
  const run = (t: Tx) =>
    t
      .select({
        batchId: batches.id,
        expiryDate: batches.expiryDate,
        quantity: stockLevels.quantity,
      })
      .from(stockLevels)
      .innerJoin(batches, eq(batches.id, stockLevels.batchId))
      .where(
        and(
          eq(stockLevels.productId, productId),
          eq(stockLevels.locationId, locationId),
          gt(stockLevels.quantity, '0'),
        ),
      )
      .orderBy(asc(batches.expiryDate));

  const rows = tx ? await run(tx) : await withTenant(orgId, run);
  return rows.map((r) => ({
    batchId: r.batchId!,
    expiryDate: r.expiryDate,
    quantity: r.quantity ?? '0',
  }));
}

/**
 * The expiry dashboard feed: what is about to go off, worst first.
 * Sorted by value at risk, because that is the number the owner acts on.
 */
export async function getExpiringStock(orgId: string, withinDays = 14) {
  return withTenant(orgId, (tx) =>
    tx
      .select()
      .from(expiringStock)
      .where(lte(expiringStock.daysRemaining, withinDays))
      .orderBy(asc(expiringStock.daysRemaining), desc(expiringStock.valueAtRisk)),
  );
}

/**
 * Today plus a shelf life, as an ISO date.
 *
 * Deliberately asked of the database rather than the Node clock: expiring_stock
 * derives days_remaining from `current_date`, and a suggestion computed in a
 * different timezone would be off by a day against the dashboard that judges it.
 */
export async function suggestedExpiryDate(orgId: string, shelfLifeDays: number) {
  const rows = await withTenant(orgId, (tx) =>
    // The ::int cast is required: without it Postgres cannot resolve which
    // `date + ?` operator is meant and fails with "operator is not unique".
    tx.execute<{ d: string }>(sql`select (current_date + ${shelfLifeDays}::int)::text as d`),
  );
  return rows[0]?.d ?? null;
}

/** Total value of stock past or nearing expiry — the headline number. */
export async function getExpiryExposure(orgId: string, withinDays = 14) {
  const [row] = await withTenant(orgId, (tx) =>
    tx
      .select({
        batchCount: sql<number>`count(*)::int`,
        valueAtRisk: sql<string>`coalesce(sum(${expiringStock.valueAtRisk}), 0)::text`,
      })
      .from(expiringStock)
      .where(and(isNotNull(expiringStock.expiryDate), lte(expiringStock.daysRemaining, withinDays))),
  );
  return row ?? { batchCount: 0, valueAtRisk: '0' };
}
