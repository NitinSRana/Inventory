import Decimal from 'decimal.js';

/**
 * VAT arithmetic for stock valuation. Pure module, no database import.
 *
 * Decimal throughout: these are money, and float rounding on a 2,000-line stock
 * report drifts by real cents.
 */

/** Net amount plus VAT at `rate` (a fraction, so 0.19 is 19%). */
export function grossValue(net: string, rate: string): string {
  return new Decimal(net).times(new Decimal(1).plus(rate)).toFixed(2);
}

/**
 * The reverse: strips VAT back out of a gross amount.
 *
 * `places` defaults to 2 for display and valuation use; the till and the POS
 * sync pipeline both pass 4, matching `numeric(12,4)` and their own
 * take-VAT-as-a-remainder pattern (this net figure, then `gross - net`) —
 * one formula rather than three copies drifting apart.
 */
export function netFromGross(gross: string, rate: string, places = 2): string {
  return new Decimal(gross).dividedBy(new Decimal(1).plus(rate)).toFixed(places);
}

/**
 * Margin against cost, as a percentage.
 *
 * `sellPrice` is gross (VAT included, what the customer pays); `costPrice` is
 * net (ex-VAT, as invoiced by the supplier). Comparing them directly, as a
 * naive `(sell - cost) / sell` would, mixes the two and overstates margin by
 * roughly the VAT rate — net sell price is extracted first via
 * `netFromGross()` so both sides of the division are net.
 *
 * Null when there's nothing to divide by — a free product isn't "infinite
 * margin", it's a question this formula can't answer.
 */
export function marginPercent(sellPriceGross: string, costPriceNet: string, vatRate: string): string | null {
  const netSell = new Decimal(netFromGross(sellPriceGross, vatRate));
  if (netSell.lessThanOrEqualTo(0)) return null;
  return netSell.minus(costPriceNet).dividedBy(netSell).times(100).toFixed(1);
}
