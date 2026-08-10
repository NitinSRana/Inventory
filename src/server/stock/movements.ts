import Decimal from 'decimal.js';
import { and, eq, isNull } from 'drizzle-orm';

import { REASON_CODES, batches, locations, stockMovements } from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';

import { allocateFefo } from './fefo';
import { getBatchStock } from './levels';

/**
 * Every write to stock is an INSERT here. A trigger rejects UPDATE and DELETE,
 * so a mistake is corrected by posting a compensating movement, never by
 * editing history.
 */

type Actor = { actorId?: string | null; note?: string | null; occurredAt?: Date };

export type ReceiveInput = Actor & {
  productId: string;
  locationId?: string;
  quantity: string;
  expiryDate?: string | null;
  lotNumber?: string | null;
  unitCost?: string | null;
  referenceType?: 'purchase_order' | 'manual';
  referenceId?: string | null;
};

export type WasteInput = Actor & {
  productId: string;
  locationId?: string;
  quantity: string;
  reasonCode: (typeof REASON_CODES)[number];
  /** Omit to deplete FEFO across batches. */
  batchId?: string | null;
};

/** Every tenant has exactly one location today; the schema is ready for more. */
async function defaultLocationId(tx: Tx): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isDefault, true))
    .limit(1);
  if (!location) throw new Error('Organization has no default location');
  return location.id;
}

/**
 * Finds the batch matching this delivery, or creates one. Two deliveries of the
 * same product with the same expiry and lot are the same batch — splitting them
 * would fragment the expiry dashboard for no benefit.
 */
async function findOrCreateBatch(
  tx: Tx,
  orgId: string,
  input: { productId: string; locationId: string; expiryDate?: string | null; lotNumber?: string | null; unitCost?: string | null },
) {
  const { productId, locationId, expiryDate = null, lotNumber = null } = input;

  const [existing] = await tx
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        eq(batches.productId, productId),
        eq(batches.locationId, locationId),
        expiryDate === null ? isNull(batches.expiryDate) : eq(batches.expiryDate, expiryDate),
        lotNumber === null ? isNull(batches.lotNumber) : eq(batches.lotNumber, lotNumber),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(batches)
    .values({ organizationId: orgId, productId, locationId, expiryDate, lotNumber, unitCost: input.unitCost ?? null })
    .returning({ id: batches.id });
  return created.id;
}

/** A delivery arrives. Captures expiry at the moment it is knowable. */
export async function receiveStock(orgId: string, input: ReceiveInput, tx?: Tx) {
  if (new Decimal(input.quantity).lessThanOrEqualTo(0)) {
    throw new Error('Receipt quantity must be positive');
  }

  const run = async (tx: Tx) => {
    const locationId = input.locationId ?? (await defaultLocationId(tx));
    const batchId = await findOrCreateBatch(tx, orgId, { ...input, locationId });

    const [movement] = await tx
      .insert(stockMovements)
      .values({
        organizationId: orgId,
        productId: input.productId,
        locationId,
        batchId,
        quantityDelta: input.quantity,
        movementType: 'receipt',
        referenceType: input.referenceType ?? 'manual',
        referenceId: input.referenceId ?? null,
        actorId: input.actorId ?? null,
        note: input.note ?? null,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      })
      .returning();
    return movement;
  };

  // Joins the caller's transaction when given one. Receiving against a purchase
  // order has to update the order lines and post the ledger rows together, and
  // opening a second transaction here would take a second connection and could
  // deadlock against the first.
  return tx ? run(tx) : withTenant(orgId, run);
}

/**
 * Something is binned. Depletes FEFO unless a specific batch is named — the
 * staff member scanning a spoiled item knows which batch it came from, but the
 * common case is "two of these went off" with no batch in hand.
 *
 * One transaction, so the batch read and the ledger writes cannot interleave
 * with another till.
 */
export async function recordWaste(orgId: string, input: WasteInput) {
  if (new Decimal(input.quantity).lessThanOrEqualTo(0)) {
    throw new Error('Waste quantity must be positive');
  }

  return withTenant(orgId, async (tx) => {
    const locationId = input.locationId ?? (await defaultLocationId(tx));

    const allocations = input.batchId
      ? [{ batchId: input.batchId, quantity: input.quantity }]
      : allocateFefo(await getBatchStock(orgId, input.productId, locationId, tx), input.quantity);

    return tx
      .insert(stockMovements)
      .values(
        allocations.map((a) => ({
          organizationId: orgId,
          productId: input.productId,
          locationId,
          batchId: a.batchId,
          // Waste is stored negative; a CHECK constraint enforces it.
          quantityDelta: new Decimal(a.quantity).negated().toString(),
          movementType: 'waste' as const,
          reasonCode: input.reasonCode,
          referenceType: 'manual' as const,
          actorId: input.actorId ?? null,
          note: input.note ?? null,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        })),
      )
      .returning();
  });
}

/**
 * Corrects a mistake. Signed, so it can go either way — this is the only
 * sanctioned way to change history, because the ledger itself cannot be edited.
 */
export async function adjustStock(
  orgId: string,
  input: Actor & {
    productId: string;
    locationId?: string;
    batchId?: string | null;
    quantityDelta: string;
    reasonCode?: (typeof REASON_CODES)[number];
  },
) {
  if (new Decimal(input.quantityDelta).isZero()) {
    throw new Error('Adjustment cannot be zero');
  }

  return withTenant(orgId, async (tx) => {
    const locationId = input.locationId ?? (await defaultLocationId(tx));
    const delta = new Decimal(input.quantityDelta);

    // A negative adjustment with no batch named must still come out of real
    // batches, FEFO, exactly as waste does. Posting it against batch_id null
    // lowers the product total while leaving every batch untouched — which makes
    // expiring_stock overstate value at risk, on the dashboard that sells the
    // product. Found by stock.itest.ts.
    const allocations =
      !input.batchId && delta.isNegative()
        ? allocateFefo(await getBatchStock(orgId, input.productId, locationId, tx), delta.abs().toString())
        : [{ batchId: input.batchId ?? null, quantity: delta.abs().toString() }];

    const rows = await tx
      .insert(stockMovements)
      .values(
        allocations.map((a) => ({
          organizationId: orgId,
          productId: input.productId,
          locationId,
          batchId: a.batchId,
          quantityDelta: delta.isNegative()
            ? new Decimal(a.quantity).negated().toString()
            : a.quantity,
          movementType: 'manual_adjustment' as const,
          reasonCode: input.reasonCode ?? ('correction' as const),
          referenceType: 'manual' as const,
          actorId: input.actorId ?? null,
          note: input.note ?? null,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
        })),
      )
      .returning();
    return rows[0];
  });
}
