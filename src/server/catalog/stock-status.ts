import Decimal from 'decimal.js';

/**
 * In stock / low / out, as the products list shows it.
 *
 * A read of min_stock against what is on hand and nothing more. It suggests no
 * order and no quantity, which is where CLAUDE.md draws the line on reordering.
 * Pure, so the boundary cases are tested without a database.
 */
export type StockStatus = 'in' | 'low' | 'out';

export function stockStatus(onHand: string, minStock: string | null): StockStatus {
  const quantity = new Decimal(onHand);
  if (quantity.lessThanOrEqualTo(0)) return 'out';
  if (minStock !== null && quantity.lessThan(minStock)) return 'low';
  return 'in';
}
