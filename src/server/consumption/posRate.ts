import Decimal from 'decimal.js';
import { and, eq, gt, sql } from 'drizzle-orm';

import { stockMovements } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import type { Confidence } from './rate';

/**
 * Consumption computed straight from real sales, not inferred from a count
 * window. A product with POS history doesn't need the opening/receipts/waste/
 * closing arithmetic in rate.ts — that machinery exists to infer depletion
 * when nothing recorded it directly, which is exactly the problem checkout
 * solves. This reads the trailing window and sums it; nothing to infer.
 *
 * Computed live at request time rather than materialized: a grocery store
 * generates a few hundred consumption rows a day, one indexed aggregate query
 * over that is cheap, and it means the number shown is never stale the way a
 * table only refreshed "as of the last count" would be.
 */

const WINDOW_DAYS = 14;

/**
 * Distinct days with a sale, not row count — ten sales in one bad Tuesday says
 * less than one sale on each of ten separate days. Thresholds are a plain
 * ladder, same spirit as rate.ts's confidenceFor: a handful of observations
 * is enough to say "some trust", not enough to say "high".
 */
function confidenceForSaleDays(days: number): Confidence {
  if (days < 3) return 'insufficient';
  if (days < 7) return 'low';
  if (days < WINDOW_DAYS) return 'medium';
  return 'high';
}

export type PosRate = { dailyRate: string; confidence: Confidence; saleDays: number };

/**
 * One row per product with at least one sale in the trailing window.
 * `getReorderSuggestions` prefers this over the count-window rate whenever it
 * clears the confidence floor, and falls back to the count-window table for a
 * product never sold through the till.
 */
export async function getLivePosRates(orgId: string): Promise<Map<string, PosRate>> {
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        productId: stockMovements.productId,
        // Stored negative; sum then negate so a rate is a positive quantity/day.
        totalConsumed: sql<string>`(-sum(${stockMovements.quantityDelta}))::text`,
        saleDays: sql<number>`count(distinct ${stockMovements.occurredAt}::date)::int`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.movementType, 'consumption'),
          gt(stockMovements.occurredAt, sql`now() - make_interval(days => ${WINDOW_DAYS})`),
        ),
      )
      .groupBy(stockMovements.productId),
  );

  const result = new Map<string, PosRate>();
  for (const r of rows) {
    const confidence = confidenceForSaleDays(r.saleDays);
    if (confidence === 'insufficient') continue;
    result.set(r.productId, {
      // .toFixed, not .toDecimalPlaces().toString(): the count-window rate this
      // stands in for comes back zero-padded from a numeric(x,4) column, and
      // the UI shouldn't see '0.5' from one source and '3.0000' from the other.
      dailyRate: new Decimal(r.totalConsumed).dividedBy(WINDOW_DAYS).toFixed(4),
      confidence,
      saleDays: r.saleDays,
    });
  }
  return result;
}
