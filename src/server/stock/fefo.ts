import Decimal from 'decimal.js';

/**
 * First-expired-first-out allocation.
 *
 * Depleting stock has to pick a batch, and picking the wrong one corrupts the
 * expiry dashboard — the feature that sells the product. A batch expiring
 * tomorrow that never gets depleted shows as at-risk value forever.
 */

export type BatchStock = {
  batchId: string;
  /** ISO date, or null for goods with no expiry. */
  expiryDate: string | null;
  /** Drizzle returns numeric as a string; it stays a string. */
  quantity: string;
};

export type Allocation = { batchId: string; quantity: string };

export class InsufficientStockError extends Error {
  // Assigned in the body, not as parameter properties: Node's type-stripping
  // test runner cannot parse those.
  readonly requested: string;
  readonly available: string;

  constructor(requested: string, available: string) {
    super(`Requested ${requested} but only ${available} on hand`);
    this.name = 'InsufficientStockError';
    this.requested = requested;
    this.available = available;
  }
}

/**
 * Splits `quantity` across batches, earliest expiry first. Batches with no
 * expiry date go last — they cannot spoil, so there is no urgency to move them.
 *
 * Arithmetic is Decimal throughout: quantities are numeric(14,3) and weighed
 * goods use all three decimals, where float rounding produces phantom stock.
 */
export function allocateFefo(batches: BatchStock[], quantity: string): Allocation[] {
  const requested = new Decimal(quantity);
  if (requested.lessThanOrEqualTo(0)) throw new Error('Quantity must be positive');

  const available = batches.reduce((sum, b) => sum.plus(b.quantity), new Decimal(0));
  if (available.lessThan(requested)) {
    throw new InsufficientStockError(requested.toString(), available.toString());
  }

  const ordered = [...batches]
    .filter((b) => new Decimal(b.quantity).greaterThan(0))
    .sort((a, b) => {
      if (a.expiryDate === b.expiryDate) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    });

  const allocations: Allocation[] = [];
  let remaining = requested;

  for (const batch of ordered) {
    if (remaining.isZero()) break;
    const take = Decimal.min(remaining, new Decimal(batch.quantity));
    allocations.push({ batchId: batch.batchId, quantity: take.toString() });
    remaining = remaining.minus(take);
  }

  return allocations;
}
