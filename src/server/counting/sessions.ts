import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { countLines, countSessions, locations, products, stockMovements } from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';

import { varianceOf, varianceSummary, type CountLine } from './variance';

/**
 * Cycle counting.
 *
 * A session stays open until it is completed, so a count interrupted by a
 * customer at the till survives — sessions are resumable by design, and nothing
 * is posted to the ledger until the session closes.
 */

async function defaultLocationId(tx: Tx): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isDefault, true))
    .limit(1);
  if (!location) throw new Error('Organization has no default location');
  return location.id;
}

export async function startCountSession(
  orgId: string,
  input: {
    name?: string | null;
    scopeType?: 'full' | 'category' | 'supplier' | 'custom';
    scopeId?: string | null;
    locationId?: string;
    startedBy?: string | null;
  } = {},
) {
  return withTenant(orgId, async (tx) => {
    const locationId = input.locationId ?? (await defaultLocationId(tx));
    const [session] = await tx
      .insert(countSessions)
      .values({
        organizationId: orgId,
        locationId,
        name: input.name ?? null,
        scopeType: input.scopeType ?? 'full',
        scopeId: input.scopeId ?? null,
        startedBy: input.startedBy ?? null,
      })
      .returning();
    return session;
  });
}

export async function getOpenSession(orgId: string) {
  const [session] = await withTenant(orgId, (tx) =>
    tx
      .select()
      .from(countSessions)
      .where(eq(countSessions.status, 'in_progress'))
      .orderBy(desc(countSessions.startedAt))
      .limit(1),
  );
  return session ?? null;
}

/**
 * Records what was found on the shelf. Captures the ledger's belief at this
 * moment, because by the time the session closes a delivery may have landed and
 * the comparison would be against the wrong number.
 *
 * Re-counting the same product replaces the earlier line: someone correcting a
 * miscount should not create two conflicting truths.
 */
export async function recordCount(
  orgId: string,
  input: {
    countSessionId: string;
    productId: string;
    countedQuantity: string;
    batchId?: string | null;
    countedBy?: string | null;
  },
) {
  return withTenant(orgId, async (tx) => {
    const [session] = await tx
      .select({ locationId: countSessions.locationId, status: countSessions.status })
      .from(countSessions)
      .where(eq(countSessions.id, input.countSessionId))
      .limit(1);
    if (!session) throw new Error('Count session not found');
    if (session.status !== 'in_progress') throw new Error('Count session is not open');

    // Read the ledger directly rather than the view: this must see the same
    // snapshot as the transaction posting adjustments later.
    const [current] = await tx
      .select({ quantity: sql<string>`coalesce(sum(${stockMovements.quantityDelta}), '0')::text` })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.productId, input.productId),
          eq(stockMovements.locationId, session.locationId),
        ),
      );

    await tx
      .delete(countLines)
      .where(
        and(
          eq(countLines.countSessionId, input.countSessionId),
          eq(countLines.productId, input.productId),
        ),
      );

    const [line] = await tx
      .insert(countLines)
      .values({
        organizationId: orgId,
        countSessionId: input.countSessionId,
        productId: input.productId,
        batchId: input.batchId ?? null,
        expectedQuantity: current?.quantity ?? '0',
        countedQuantity: input.countedQuantity,
        countedBy: input.countedBy ?? null,
      })
      .returning();
    return line;
  });
}

export async function getSessionLines(orgId: string, countSessionId: string) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        id: countLines.id,
        productId: countLines.productId,
        productName: products.name,
        gtin: products.gtin,
        unit: products.unit,
        costPrice: products.costPrice,
        batchId: countLines.batchId,
        expectedQuantity: countLines.expectedQuantity,
        countedQuantity: countLines.countedQuantity,
      })
      .from(countLines)
      .innerJoin(products, eq(products.id, countLines.productId))
      .where(eq(countLines.countSessionId, countSessionId))
      .orderBy(asc(products.name)),
  );
}

/** Variance report for an open session — read-only, safe to look at mid-count. */
export async function getVarianceReport(orgId: string, countSessionId: string) {
  const lines = await getSessionLines(orgId, countSessionId);
  const variances = varianceOf(lines as CountLine[]);
  const costs = Object.fromEntries(lines.map((l) => [l.productId, l.costPrice]));
  const names = Object.fromEntries(lines.map((l) => [l.productId, l.productName]));

  return {
    summary: varianceSummary(variances, costs),
    variances: variances.map((v) => ({ ...v, productName: names[v.productId] })),
  };
}

/**
 * Closes the session and posts one count_adjustment per differing line, so the
 * ledger agrees with the shelf.
 *
 * All of it in one transaction: a half-posted count would leave the ledger in a
 * state nobody counted.
 */
export async function completeCountSession(
  orgId: string,
  countSessionId: string,
  actorId?: string | null,
) {
  return withTenant(orgId, async (tx) => {
    const [session] = await tx
      .select()
      .from(countSessions)
      .where(eq(countSessions.id, countSessionId))
      .limit(1);
    if (!session) throw new Error('Count session not found');
    if (session.status !== 'in_progress') throw new Error('Count session is not open');

    const lines = await tx
      .select({
        productId: countLines.productId,
        batchId: countLines.batchId,
        expectedQuantity: countLines.expectedQuantity,
        countedQuantity: countLines.countedQuantity,
      })
      .from(countLines)
      .where(eq(countLines.countSessionId, countSessionId));

    const variances = varianceOf(lines);

    if (variances.length > 0) {
      await tx.insert(stockMovements).values(
        variances.map((v) => ({
          organizationId: orgId,
          productId: v.productId,
          locationId: session.locationId,
          batchId: v.batchId,
          quantityDelta: v.delta,
          movementType: 'count_adjustment' as const,
          reasonCode: 'correction' as const,
          referenceType: 'count_session' as const,
          referenceId: countSessionId,
          actorId: actorId ?? null,
        })),
      );
    }

    await tx
      .update(countSessions)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(countSessions.id, countSessionId));

    return { adjustmentsPosted: variances.length };
  });
}
