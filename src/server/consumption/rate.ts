import Decimal from 'decimal.js';

/**
 * Consumption is derived, never recorded:
 *
 *   consumption = opening count + receipts − waste − closing count
 *
 * Nobody enters a sale. Two counts of the same product, plus the ledger between
 * them, is enough to say how fast it moves — which is all reordering needs.
 */

export type Period = {
  /** Counted quantity at the start of the window. */
  opening: string;
  /** Counted quantity at the end of the window. */
  closing: string;
  /** Positive total of receipts between the two counts. */
  receipts: string;
  /** Positive total of stock binned between the two counts. */
  waste: string;
  /** Days between the two counts. */
  days: number;
};

export type Confidence = 'insufficient' | 'low' | 'medium' | 'high';

export type Rate = {
  consumed: string;
  dailyRate: string | null;
  sampleCount: number;
  confidence: Confidence;
};

/**
 * ponytail: sample count alone, no variance weighting. A product counted five
 * times over five weeks is treated as well-understood even if the numbers swing
 * wildly. Revisit once there is real data to tune against.
 */
function confidenceFor(sampleCount: number): Confidence {
  if (sampleCount < 1) return 'insufficient';
  if (sampleCount === 1) return 'low';
  if (sampleCount < 4) return 'medium';
  return 'high';
}

/**
 * Consumption across one count-to-count window.
 *
 * Returns a null rate rather than a zero when the window cannot support a
 * number — a confident zero would tell a shop to stop ordering something that
 * simply has not been counted twice yet.
 */
export function consumptionForPeriod(period: Period): { consumed: string; dailyRate: string | null } {
  const consumed = new Decimal(period.opening)
    .plus(period.receipts)
    .minus(period.waste)
    .minus(period.closing);

  if (period.days <= 0) return { consumed: consumed.toString(), dailyRate: null };

  // Negative consumption means the ledger and the shelf disagree in a way this
  // model cannot explain — an unrecorded delivery, or a miscount. Reporting a
  // negative rate would make the reorder maths order nothing, so it is floored
  // at zero and left for the variance report to surface.
  const floored = consumed.isNegative() ? new Decimal(0) : consumed;

  return {
    consumed: consumed.toString(),
    dailyRate: floored.dividedBy(period.days).toDecimalPlaces(4).toString(),
  };
}

/** Averages several windows. More windows means more trust, nothing more. */
export function aggregateRate(periods: Period[]): Rate {
  const usable = periods.filter((p) => p.days > 0);
  if (usable.length === 0) {
    return { consumed: '0', dailyRate: null, sampleCount: 0, confidence: 'insufficient' };
  }

  let totalConsumed = new Decimal(0);
  let totalDays = 0;
  for (const period of usable) {
    const { consumed } = consumptionForPeriod(period);
    const c = new Decimal(consumed);
    totalConsumed = totalConsumed.plus(c.isNegative() ? 0 : c);
    totalDays += period.days;
  }

  return {
    consumed: totalConsumed.toString(),
    dailyRate: totalConsumed.dividedBy(totalDays).toDecimalPlaces(4).toString(),
    sampleCount: usable.length,
    confidence: confidenceFor(usable.length),
  };
}

/**
 * How much to order: cover the lead time plus a buffer, minus what is already
 * on hand or on its way.
 *
 * No forecasting. Rate times lead time with a safety factor, as the spec asks —
 * a grocer can sanity-check that arithmetic in their head, which matters more
 * than accuracy they cannot audit.
 */
export function suggestedOrderQuantity(input: {
  dailyRate: string | null;
  leadTimeDays: number;
  onHand: string;
  onOrder: string;
  minStock?: string | null;
  /** Extra days of cover beyond the lead time. */
  safetyDays?: number;
}): string | null {
  const { dailyRate, leadTimeDays, onHand, onOrder, minStock, safetyDays = 3 } = input;
  if (dailyRate === null) return null;

  const target = new Decimal(dailyRate).times(leadTimeDays + safetyDays);
  const floor = new Decimal(minStock ?? 0);
  const needed = Decimal.max(target, floor).minus(onHand).minus(onOrder);

  return needed.greaterThan(0) ? needed.toDecimalPlaces(3).toString() : null;
}
