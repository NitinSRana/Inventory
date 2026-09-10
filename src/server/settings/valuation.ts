import Decimal from 'decimal.js';

import type { VatBand } from './vat-seeds';

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

/** A sale reached a band the shop never gave a rate for. */
export class UnconfiguredVatBandError extends Error {
  // Declared rather than a parameter property: this module is reached by the
  // unit suite, which runs on Node's strip-only TypeScript and rejects those.
  readonly band: VatBand;

  constructor(band: VatBand) {
    super(`No VAT rate is configured for the ${band} band`);
    this.name = 'UnconfiguredVatBandError';
    this.band = band;
  }
}

/**
 * The rate to charge, or a refusal — never a guess.
 *
 * Zero-rated is the one band that needs no row: the band *is* the rate, and
 * most food in the UK sits there. Every other band carries VAT by definition,
 * so an absent rate is a question nobody can answer at the till, and answering
 * it with 0% silently under-declares on every line.
 */
export function rateForBand(rates: Partial<Record<VatBand, string>>, band: VatBand): string {
  if (band === 'zero') return rates.zero ?? '0';
  const rate = rates[band];
  if (rate === undefined) throw new UnconfiguredVatBandError(band);
  return rate;
}

/**
 * Seeds the bands for a country, if nothing is set yet.
 *
 * Deliberately refuses to overwrite: a tenant that has adjusted a rate should
 * not have it silently reset by someone re-picking the country.
 */
