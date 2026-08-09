import Decimal from 'decimal.js';

/**
 * Variance between what the ledger believed and what someone actually found on
 * the shelf. The counted number always wins — a person holding the stock is a
 * better authority than a derived total.
 */

export type CountLine = {
  productId: string;
  batchId: string | null;
  /** What the ledger believed when the line was counted. Null = product unknown to the ledger. */
  expectedQuantity: string | null;
  countedQuantity: string;
};

export type Variance = {
  productId: string;
  batchId: string | null;
  expected: string;
  counted: string;
  /** Signed: positive means more on the shelf than the ledger thought. */
  delta: string;
};

/**
 * Turns counted lines into the ledger adjustments needed to make the ledger
 * agree with the shelf. Lines that already agree produce nothing — posting a
 * zero movement is rejected by a CHECK constraint, and would be noise anyway.
 */
export function varianceOf(lines: CountLine[]): Variance[] {
  return lines
    .map((line) => {
      const expected = new Decimal(line.expectedQuantity ?? 0);
      const counted = new Decimal(line.countedQuantity);
      return {
        productId: line.productId,
        batchId: line.batchId,
        expected: expected.toString(),
        counted: counted.toString(),
        delta: counted.minus(expected).toString(),
      };
    })
    .filter((v) => !new Decimal(v.delta).isZero());
}

/** Headline numbers for the variance report: how wrong were we, and by how much value. */
export function varianceSummary(variances: Variance[], unitCosts: Record<string, string | null>) {
  let shrinkValue = new Decimal(0);
  let gainValue = new Decimal(0);
  let linesShort = 0;
  let linesOver = 0;

  for (const v of variances) {
    const delta = new Decimal(v.delta);
    const cost = new Decimal(unitCosts[v.productId] ?? 0);
    const value = delta.times(cost);
    if (delta.isNegative()) {
      linesShort += 1;
      shrinkValue = shrinkValue.plus(value.abs());
    } else {
      linesOver += 1;
      gainValue = gainValue.plus(value);
    }
  }

  return {
    linesWithVariance: variances.length,
    linesShort,
    linesOver,
    shrinkValue: shrinkValue.toString(),
    gainValue: gainValue.toString(),
    netValue: gainValue.minus(shrinkValue).toString(),
  };
}
