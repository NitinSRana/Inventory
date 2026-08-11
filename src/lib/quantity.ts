import Decimal from 'decimal.js';

/**
 * Quantities are `numeric(14,3)`, so Postgres hands back `"22.000"` for twenty-two
 * eggs. Printed raw it reads like a laboratory measurement, and three dead zeros
 * on every row is exactly the noise that makes a stock list unscannable.
 *
 * Trims the string rather than parsing it: `parseFloat` on a quantity is the
 * habit that eventually gets applied to money.
 */
export function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * A consumption rate is an estimate derived from two counts, not a measurement.
 * `3.4286/day` claims a precision the data does not have and nobody can act on;
 * one decimal is the honest width.
 */
export function formatRate(value: string): string {
  return trimQuantity(new Decimal(value).toFixed(1));
}
