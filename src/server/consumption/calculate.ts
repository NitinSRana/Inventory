import Decimal from 'decimal.js';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { consumptionRates, countLines, countSessions, stockMovements } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { aggregateRate, type Period, type Rate } from './rate';

/**
 * Turns count history into consumption rates.
 *
 * Two completed counts of a product bound a window; the ledger supplies what
 * came in and what was binned inside it. Everything else is derived.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type CountPoint = { productId: string; locationId: string; countedAt: Date; quantity: string };

/**
 * Recalculates every product with at least two completed counts and stores the
 * result. Two queries total rather than one per product — a 2,000-SKU catalogue
 * would otherwise be 2,000 round trips.
 */
export async function recalculateConsumptionRates(orgId: string) {
  return withTenant(orgId, async (tx) => {
    const points: CountPoint[] = await tx
      .select({
        productId: countLines.productId,
        locationId: countSessions.locationId,
        countedAt: countLines.countedAt,
        quantity: countLines.countedQuantity,
      })
      .from(countLines)
      .innerJoin(countSessions, eq(countSessions.id, countLines.countSessionId))
      .where(eq(countSessions.status, 'completed'))
      .orderBy(asc(countLines.productId), asc(countLines.countedAt));

    // Products counted only once cannot bound a window yet.
    const byProduct = new Map<string, CountPoint[]>();
    for (const p of points) {
      const key = `${p.productId}:${p.locationId}`;
      byProduct.set(key, [...(byProduct.get(key) ?? []), p]);
    }
    const eligible = [...byProduct.entries()].filter(([, ps]) => ps.length >= 2);
    if (eligible.length === 0) return { updated: 0, skipped: byProduct.size };

    const productIds = [...new Set(eligible.map(([key]) => key.split(':')[0]))];
    const movements = await tx
      .select({
        productId: stockMovements.productId,
        locationId: stockMovements.locationId,
        movementType: stockMovements.movementType,
        occurredAt: stockMovements.occurredAt,
        quantityDelta: stockMovements.quantityDelta,
      })
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.productId, productIds),
          inArray(stockMovements.movementType, ['receipt', 'waste']),
        ),
      );

    let updated = 0;
    for (const [key, ps] of eligible) {
      const [productId, locationId] = key.split(':');
      const periods: Period[] = [];

      for (let i = 1; i < ps.length; i++) {
        const from = ps[i - 1].countedAt;
        const to = ps[i].countedAt;
        const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));

        // Strictly inside the window: a receipt posted at the exact moment of a
        // count belongs to whichever side the till operator meant, and counting
        // it twice is worse than dropping it.
        const inWindow = movements.filter(
          (m) =>
            m.productId === productId &&
            m.locationId === locationId &&
            m.occurredAt > from &&
            m.occurredAt <= to,
        );

        // Decimal, not Number: these are numeric(14,3) and weighed goods use
        // every decimal place.
        const sum = (type: 'receipt' | 'waste') =>
          inWindow
            .filter((m) => m.movementType === type)
            .reduce((acc, m) => acc.plus(new Decimal(m.quantityDelta).abs()), new Decimal(0))
            .toString();

        periods.push({
          opening: ps[i - 1].quantity,
          closing: ps[i].quantity,
          receipts: sum('receipt'),
          waste: sum('waste'),
          days,
        });
      }

      const rate: Rate = aggregateRate(periods);
      if (rate.confidence === 'insufficient') continue;

      await tx
        .insert(consumptionRates)
        .values({
          organizationId: orgId,
          productId,
          locationId,
          dailyRate: rate.dailyRate,
          periodStart: ps[0].countedAt,
          periodEnd: ps[ps.length - 1].countedAt,
          sampleCount: rate.sampleCount,
          confidence: rate.confidence,
          calculatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [consumptionRates.organizationId, consumptionRates.productId, consumptionRates.locationId],
          set: {
            dailyRate: rate.dailyRate,
            periodStart: ps[0].countedAt,
            periodEnd: ps[ps.length - 1].countedAt,
            sampleCount: rate.sampleCount,
            confidence: rate.confidence,
            calculatedAt: new Date(),
          },
        });
      updated += 1;
    }

    return { updated, skipped: byProduct.size - updated };
  });
}

/** What the UI shows next to a product. Null rate means "not enough data yet". */
export async function getConsumptionRate(orgId: string, productId: string) {
  const [rate] = await withTenant(orgId, (tx) =>
    tx
      .select()
      .from(consumptionRates)
      .where(eq(consumptionRates.productId, productId))
      .limit(1),
  );
  return rate ?? null;
}

/** Days of cover left at the current rate, or null when the rate is unknown. */
export async function getDaysOfCover(orgId: string, productId: string, onHand: string) {
  const rate = await getConsumptionRate(orgId, productId);
  if (!rate?.dailyRate) return null;
  const daily = new Decimal(rate.dailyRate);
  if (daily.lessThanOrEqualTo(0)) return null;
  return new Decimal(onHand).dividedBy(daily).toDecimalPlaces(1).toNumber();
}
