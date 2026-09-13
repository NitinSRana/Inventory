import Decimal from 'decimal.js';

import { netFromGross } from '../settings/valuation.ts';

/**
 * What a basket costs, once FEFO has decided which batches it comes out of.
 *
 * Pure on purpose. The till writes these lines and the checkout screen previews
 * them, and if those were two calculations they would eventually disagree about
 * what a shopper owes — the one number that must never differ between the
 * screen and the receipt. It also keeps the money rules testable without a
 * database.
 */

/** One FEFO slice, carrying its batch's markdown if a manager set one. */
export type PricedAllocation = {
  batchId: string;
  quantity: string;
  /** Gross, VAT included. Null or absent means the batch sells at shelf price. */
  markdownPrice?: string | null;
};

export type SaleLinePlan = {
  /** Gross price per unit actually charged. */
  unitPrice: string;
  /** The shelf price at the moment of sale, stored so a markdown's effect is a
   *  fact on the line rather than something recomputed from today's price. */
  listPrice: string;
  quantity: string;
  /** Gross. */
  lineTotal: string;
  /** Net, 4dp: what the subtotal sums. */
  net: string;
  /** The remainder, so net + vat reconstructs the gross exactly. */
  vatAmount: string;
  markedDown: boolean;
};

/**
 * Turns one product's FEFO allocation into sale lines — one per price.
 *
 * Three cartons of milk where two come from a marked-down batch are two lines,
 * not one line at a blended price: a blended unit price is a number nobody put
 * on a label, and it would hide from the receipt, the VAT report and the
 * mitigated-loss figure alike which units went at which price.
 *
 * A markdown at or above the current shelf price is ignored. It was set against
 * an older, higher price; charging it now would mean the "reduced" item costs
 * more than the fresh one beside it.
 *
 * Money order follows the rule the till already used: price × quantity first,
 * then VAT is extracted from that gross, and VAT is the remainder rather than
 * an independent calculation.
 */
export function planLines(
  shelfPrice: string,
  vatRate: string,
  allocations: readonly PricedAllocation[],
): SaleLinePlan[] {
  const shelf = new Decimal(shelfPrice);
  const quantityByPrice = new Map<string, Decimal>();

  for (const a of allocations) {
    const markdown =
      a.markdownPrice != null && new Decimal(a.markdownPrice).lessThan(shelf)
        ? new Decimal(a.markdownPrice)
        : shelf;
    const key = markdown.toFixed(4);
    quantityByPrice.set(key, (quantityByPrice.get(key) ?? new Decimal(0)).plus(a.quantity));
  }

  return [...quantityByPrice.entries()]
    // Marked-down lines first: they are why this basket reads differently.
    .sort(([a], [b]) => new Decimal(a).comparedTo(new Decimal(b)))
    .map(([price, quantity]) => {
      const unit = new Decimal(price);
      const lineTotal = unit.times(quantity);
      const net = new Decimal(netFromGross(lineTotal.toString(), vatRate, 4));
      return {
        unitPrice: unit.toString(),
        listPrice: shelf.toString(),
        quantity: quantity.toString(),
        lineTotal: lineTotal.toDecimalPlaces(4).toString(),
        net: net.toString(),
        vatAmount: lineTotal.minus(net).toDecimalPlaces(4).toString(),
        markedDown: unit.lessThan(shelf),
      };
    });
}
