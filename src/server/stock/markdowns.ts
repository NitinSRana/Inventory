import Decimal from 'decimal.js';
import { eq, sql } from 'drizzle-orm';

import { batches, organizations, products, saleLines, sales } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { SALE_OCCURRED } from '@/server/pos/checkout';

/**
 * Marking a near-expiry batch down.
 *
 * A manager's decision about one batch, never an automatic rule: a price cut is
 * money leaving the shop, so a person decides each one and is recorded against
 * it. The till then charges the reduced price only for the units FEFO actually
 * takes out of that batch — see planSale in server/pos/checkout.ts.
 *
 * Manager-only is enforced by the pages that call this, the same as voiding.
 */

export type MarkdownRefusal = 'invalidPrice' | 'notFound' | 'noShelfPrice' | 'notBelowShelf' | 'expiredUseBy';

export class MarkdownRefusedError extends Error {
  // Declared rather than a parameter property: Node's strip-only TypeScript
  // rejects those, and the unit suite loads modules through it.
  readonly reason: MarkdownRefusal;

  constructor(reason: MarkdownRefusal) {
    super(`Markdown refused: ${reason}`);
    this.name = 'MarkdownRefusedError';
    this.reason = reason;
  }
}

/**
 * Sets a batch's reduced price. Gross, like the shelf price it is cut from.
 *
 * Refused when it would not actually be a reduction, and on an expired use-by
 * batch: that stock cannot be sold at any price, and a sticker on it would only
 * suggest otherwise.
 */
export async function setBatchMarkdown(
  orgId: string,
  input: { batchId: string; price: string; actorId?: string | null },
) {
  let price: Decimal;
  try {
    price = new Decimal(input.price.trim().replace(',', '.'));
  } catch {
    throw new MarkdownRefusedError('invalidPrice');
  }
  if (!price.isFinite() || price.lessThanOrEqualTo(0)) throw new MarkdownRefusedError('invalidPrice');

  return withTenant(orgId, async (tx) => {
    // RLS scopes this: another shop's batch id finds nothing, same as a typo.
    const [batch] = await tx
      .select({
        id: batches.id,
        sellPrice: products.sellPrice,
        dateType: batches.dateType,
        // From the database's clock, the same "today" the till refuses by.
        expired: sql<boolean>`(${batches.expiryDate} is not null and ${batches.expiryDate} < current_date)`,
      })
      .from(batches)
      .innerJoin(products, eq(products.id, batches.productId))
      .where(eq(batches.id, input.batchId))
      .limit(1);

    if (!batch) throw new MarkdownRefusedError('notFound');
    if (!batch.sellPrice) throw new MarkdownRefusedError('noShelfPrice');
    if (!price.lessThan(batch.sellPrice)) throw new MarkdownRefusedError('notBelowShelf');
    if (batch.dateType === 'use_by' && batch.expired) throw new MarkdownRefusedError('expiredUseBy');

    const [updated] = await tx
      .update(batches)
      .set({
        markdownPrice: price.toDecimalPlaces(4).toString(),
        markedDownAt: new Date(),
        markedDownBy: input.actorId ?? null,
      })
      .where(eq(batches.id, input.batchId))
      .returning();
    return updated;
  });
}

/** Puts a batch back to shelf price. */
export async function clearBatchMarkdown(orgId: string, batchId: string) {
  const [updated] = await withTenant(orgId, (tx) =>
    tx
      .update(batches)
      .set({ markdownPrice: null, markedDownAt: null, markedDownBy: null })
      .where(eq(batches.id, batchId))
      .returning(),
  );
  if (!updated) throw new MarkdownRefusedError('notFound');
  return updated;
}

/**
 * Money taken this calendar month for units that sold marked down.
 *
 * The dashboard's "Mitigated losses (M-T-D)": stock that was close to expiring
 * and sold anyway, at a reduced price, instead of being thrown away. It sums
 * what those lines brought in **ex-VAT** — money that would otherwise have gone
 * in the bin with the stock.
 *
 * Net, not gross, on purpose. It sits beside "value at risk", which is priced at
 * cost and so carries no VAT; a gross figure next to it would compare the two
 * sides of VAT on one screen. And the VAT on a marked-down sale was never the
 * shop's to recover — it is owed on the sale either way.
 *
 * Read entirely off stored facts: `unit_price < list_price` on the line itself,
 * never a comparison with today's shelf price, so editing a product cannot
 * restate a month that has already happened. Completed sales only — a voided
 * sale recovered nothing. The month starts in the shop's own timezone.
 */
export async function getMitigatedLosses(orgId: string): Promise<string> {
  const rows = await withTenant(orgId, (tx) =>
    tx.execute<{ recovered: string }>(sql`
      select coalesce(round(sum(${saleLines.lineTotal} - ${saleLines.vatAmount}), 2), 0)::text as recovered
      from ${saleLines}
      join ${sales} on ${sales.id} = ${saleLines.saleId}
      join ${organizations} on ${organizations.id} = ${sales.organizationId}
      where ${sales.status} = 'completed'
        and ${saleLines.unitPrice} < ${saleLines.listPrice}
        and (${SALE_OCCURRED} at time zone ${organizations.timezone})
          >= date_trunc('month', now() at time zone ${organizations.timezone})`),
  );
  return rows[0]?.recovered ?? '0';
}
