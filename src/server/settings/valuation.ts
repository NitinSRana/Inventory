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

/** The reverse: strips VAT back out of a gross amount. */
export function netFromGross(gross: string, rate: string): string {
  return new Decimal(gross).dividedBy(new Decimal(1).plus(rate)).toFixed(2);
}
