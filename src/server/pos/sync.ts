import Decimal from 'decimal.js';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import {
  locations,
  posUnmatchedLines,
  products,
  saleLines,
  sales,
  stockMovements,
} from '@/db/schema';
import { withTenant, type Tx } from '@/db/tenant';
import { normalizeGtin } from '@/server/catalog/ean';
import { netFromGross } from '@/server/settings/valuation';
import { getRatesByBand } from '@/server/settings/vat';
import { allocateFefoPartial } from '@/server/stock/fefo';
import { getBatchStock } from '@/server/stock/levels';

import type { ExternalSale, SalesSource, SyncResult } from './sources/types';

/**
 * Importing sales from an external EPOS.
 *
 * Provider-agnostic by construction: everything here works against
 * `ExternalSale`, so connecting a second till system later is one adapter, not
 * a second pipeline.
 *
 * ---------------------------------------------------------------------------
 * Three decisions worth understanding before changing anything here.
 *
 * 1. WHO OWNS WHICH TRUTH.
 *    Their EPOS took the money, so it is authoritative for what happened and
 *    when. We are authoritative for stock. That is why a sale is never refused,
 *    never re-priced downward, and never silently dropped.
 *
 * 2. MONEY IS COMPUTED THE SAME WAY OUR TILL COMPUTES IT.
 *    Line prices come from the provider when given — a promotion at their till
 *    is a real price the customer really paid — and fall back to our own
 *    sellPrice. VAT is then extracted from that gross figure using OUR bands,
 *    exactly as checkout.ts does, so `subtotal + vatTotal === total` holds for
 *    every sale in the table regardless of where it came from. Reports must not
 *    have to ask which till a row came from.
 *
 * 3. NOTHING IS EVER DROPPED.
 *    An unknown barcode goes to `pos_unmatched_lines`, not to the floor. Stock
 *    we did not know we had sold goes negative rather than being clamped at
 *    zero. Both are signals; silence is not.
 * ---------------------------------------------------------------------------
 */

/** How far back to re-fetch on every run. */
const OVERLAP_MINUTES = 30;

/**
 * Deliberate overlap.
 *
 * A provider that timestamps a transaction at its *start* can make a sale
 * "appear" behind one we already fetched, so a high-water mark alone loses
 * rows. Re-fetching a window costs nothing: the unique index on
 * (organization_id, source, external_ref) throws duplicates away in the
 * database, so correctness never depends on the caller being careful.
 */
export function windowSince(syncedThrough: Date | null, now = new Date()): Date {
  if (!syncedThrough) {
    // First ever sync: a day, not all of history. Backfilling years of sales
    // into an expiry-driven product helps nobody and takes minutes.
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  return new Date(syncedThrough.getTime() - OVERLAP_MINUTES * 60 * 1000);
}

async function defaultLocationId(tx: Tx): Promise<string> {
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.isDefault, true))
    .limit(1);
  if (!location) throw new Error('Organization has no default location');
  return location.id;
}

/**
 * Imports a batch of already-normalised external sales.
 *
 * Each sale gets its own transaction: one malformed sale in a day's trading
 * must not roll back the other four hundred.
 */
export async function applyExternalSales(
  orgId: string,
  externalSales: ExternalSale[],
  options: { locationId?: string; connectionId?: string | null } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    fetched: externalSales.length,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    oversold: 0,
    errors: [],
  };
  if (externalSales.length === 0) return result;

  const alreadyImported = await withTenant(orgId, async (tx) => {
    const refs = externalSales.map((s) => s.externalRef);
    const rows = await tx
      .select({ externalRef: sales.externalRef })
      .from(sales)
      .where(and(eq(sales.source, 'epos_now'), inArray(sales.externalRef, refs)));
    return new Set(rows.map((r) => r.externalRef));
  });

  for (const sale of externalSales) {
    if (alreadyImported.has(sale.externalRef)) {
      result.skipped++;
      continue;
    }
    try {
      const outcome = await importOne(orgId, sale, options);
      result.imported += outcome.imported ? 1 : 0;
      result.skipped += outcome.imported ? 0 : 1;
      result.unmatched += outcome.unmatched;
      result.oversold += outcome.oversold;
    } catch (e) {
      result.errors.push(`${sale.externalRef}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

async function importOne(
  orgId: string,
  sale: ExternalSale,
  options: { locationId?: string; connectionId?: string | null },
) {
  return withTenant(orgId, async (tx) => {
    const locationId = options.locationId ?? (await defaultLocationId(tx));
    const rates = await getRatesByBand(orgId);

    /*
     * Refunds are not applied yet. Recording one as a sale would deplete stock
     * for goods coming back, which is worse than not recording it — so it is
     * counted and skipped loudly rather than guessed at.
     */
    if (sale.isRefund) {
      throw new Error('Refunds from an external till are not supported yet');
    }

    // Resolve every barcode in one query rather than one per line.
    const codes = sale.lines
      .map((l) => (l.barcode ? normalizeGtin(l.barcode) : null))
      .filter((c): c is string => c !== null);

    const matched = codes.length
      ? await tx
          .select({
            id: products.id,
            gtin: products.gtin,
            caseGtin: products.caseGtin,
            unitsPerCase: products.unitsPerCase,
            sellPrice: products.sellPrice,
            vatBand: products.vatBand,
          })
          .from(products)
          .where(or(inArray(products.gtin, codes), inArray(products.caseGtin, codes)))
      : [];

    const byCode = new Map<string, (typeof matched)[number]>();
    for (const p of matched) {
      if (p.gtin) byCode.set(p.gtin, p);
      if (p.caseGtin) byCode.set(p.caseGtin, p);
    }

    let subtotal = new Decimal(0);
    let vatTotal = new Decimal(0);
    let unmatchedCount = 0;
    let oversoldCount = 0;

    // Merged by product: their till may list the same item twice, and
    // sale_lines has a unique (sale_id, product_id). Gross value is accumulated
    // per original line rather than recomputed from a merged quantity, because
    // the two occurrences can carry different prices (a promo unit alongside a
    // full-price one) — averaging the price first and multiplying after would
    // silently drop whichever price was seen first.
    const lineByProduct = new Map<
      string,
      { quantity: Decimal; grossTotal: Decimal; vatBand: string }
    >();
    const movementValues: (typeof stockMovements.$inferInsert)[] = [];

    for (const line of sale.lines) {
      const code = line.barcode ? normalizeGtin(line.barcode) : null;
      const product = code ? byCode.get(code) : undefined;

      if (!product) {
        unmatchedCount++;
        await recordUnmatched(tx, orgId, line.barcode ?? '(none)', line.description ?? null, line.quantity, options.connectionId ?? null);
        continue;
      }

      /*
       * A case barcode at a till almost always means the whole case went out —
       * a multipack sold as one unit. Convert, the same way receiving does, so
       * stock moves by units and not by boxes.
       */
      const scannedCase = code === product.caseGtin && code !== product.gtin;
      const multiplier =
        scannedCase && product.unitsPerCase ? new Decimal(product.unitsPerCase) : new Decimal(1);
      const quantity = new Decimal(line.quantity).times(multiplier);
      if (quantity.lessThanOrEqualTo(0)) continue;

      // Their price when we have it — a promotion is a real price the customer
      // really paid. Ours only as a fallback.
      const unitPrice = new Decimal(line.unitPrice ?? product.sellPrice ?? '0');

      const lineGross = unitPrice.times(quantity);
      const existing = lineByProduct.get(product.id);
      lineByProduct.set(product.id, {
        quantity: existing ? existing.quantity.plus(quantity) : quantity,
        grossTotal: existing ? existing.grossTotal.plus(lineGross) : lineGross,
        vatBand: product.vatBand,
      });

      // Deplete FEFO, taking what exists and letting the rest go negative.
      const { allocations, shortfall } = allocateFefoPartial(
        await getBatchStock(orgId, product.id, locationId, tx),
        quantity.toString(),
      );
      for (const a of allocations) {
        movementValues.push({
          organizationId: orgId,
          productId: product.id,
          locationId,
          batchId: a.batchId,
          quantityDelta: new Decimal(a.quantity).negated().toString(),
          movementType: 'consumption',
          referenceType: 'sale',
        });
      }
      if (new Decimal(shortfall).greaterThan(0)) {
        oversoldCount++;
        movementValues.push({
          organizationId: orgId,
          productId: product.id,
          locationId,
          batchId: null,
          quantityDelta: new Decimal(shortfall).negated().toString(),
          movementType: 'consumption',
          referenceType: 'sale',
          note: 'Sold at the external till with no matching batch on hand — a delivery was probably never recorded',
        });
      }
    }

    // Money, computed exactly as checkout.ts does it: prices are gross, VAT is
    // the remainder after deriving net, so net + vat === gross to the penny.
    const lineValues: (typeof saleLines.$inferInsert)[] = [];
    for (const [productId, line] of lineByProduct) {
      const lineTotal = line.grossTotal.toDecimalPlaces(4);
      const vatRate = new Decimal(rates[line.vatBand as keyof typeof rates] ?? '0');
      const lineNet = new Decimal(netFromGross(lineTotal.toString(), vatRate.toString(), 4));
      const vatAmount = lineTotal.minus(lineNet);

      subtotal = subtotal.plus(lineNet);
      vatTotal = vatTotal.plus(vatAmount);

      // Weighted average, for display only — the money above was never derived
      // from it, so two differently-priced lines for the same product still sum
      // to the exact total the customer paid.
      const unitPrice = line.quantity.greaterThan(0)
        ? line.grossTotal.dividedBy(line.quantity).toDecimalPlaces(4)
        : new Decimal(0);

      lineValues.push({
        organizationId: orgId,
        saleId: '',
        productId,
        quantity: line.quantity.toString(),
        unitPrice: unitPrice.toString(),
        vatBand: line.vatBand as 'standard' | 'reduced' | 'super_reduced' | 'zero',
        vatAmount: vatAmount.toDecimalPlaces(4).toString(),
        lineTotal: lineTotal.toString(),
      });
    }

    // Every line was unmatched: there is no sale we can meaningfully record,
    // but the barcodes are now queued, which is the useful half.
    if (lineValues.length === 0) {
      return { imported: false, unmatched: unmatchedCount, oversold: oversoldCount };
    }

    const total = subtotal.plus(vatTotal);

    /*
     * If their reported total disagrees with ours, keep ours — it is internally
     * consistent and reconcilable — but say so on the row. A persistent gap
     * usually means unmatched lines or a promotion we cannot see, and it should
     * be visible rather than quietly absorbed.
     */
    const reported = sale.total ? new Decimal(sale.total) : null;
    const note =
      reported && !reported.toDecimalPlaces(2).equals(total.toDecimalPlaces(2))
        ? `Provider reported ${reported.toFixed(2)}; computed ${total.toFixed(2)} from ${lineValues.length} matched line(s)${unmatchedCount ? ` and ${unmatchedCount} unmatched` : ''}`
        : null;

    const [inserted] = await tx
      .insert(sales)
      .values({
        organizationId: orgId,
        locationId,
        saleNumber: `EPOS-${sale.externalRef}`,
        source: 'epos_now',
        externalRef: sale.externalRef,
        occurredAt: sale.occurredAt,
        subtotal: subtotal.toDecimalPlaces(4).toString(),
        vatTotal: vatTotal.toDecimalPlaces(4).toString(),
        total: total.toDecimalPlaces(4).toString(),
        tenderType: sale.tenderType ?? 'card',
      })
      .returning({ id: sales.id });

    await tx.insert(saleLines).values(lineValues.map((l) => ({ ...l, saleId: inserted.id })));
    if (movementValues.length) {
      await tx.insert(stockMovements).values(
        movementValues.map((m) => ({ ...m, referenceId: inserted.id, occurredAt: sale.occurredAt })),
      );
    }
    if (note) {
      // Surfaced on the sync screen once built.
      console.warn(`[pos-sync] ${sale.externalRef}: ${note}`);
    }

    return { imported: true, unmatched: unmatchedCount, oversold: oversoldCount };
  });
}

/**
 * Records a barcode we could not match.
 *
 * Upsert rather than insert: the same unknown item sells all week, and forty
 * rows for one missing product buries the signal. One row with a running total
 * shows how much drift it represents, which is what decides whether it matters.
 */
async function recordUnmatched(
  tx: Tx,
  orgId: string,
  barcode: string,
  description: string | null,
  quantity: string,
  connectionId: string | null,
) {
  await tx
    .insert(posUnmatchedLines)
    .values({
      organizationId: orgId,
      connectionId,
      barcode,
      description,
      quantity,
      timesSeen: 1,
    })
    .onConflictDoUpdate({
      target: [posUnmatchedLines.organizationId, posUnmatchedLines.barcode],
      set: {
        quantity: sql`${posUnmatchedLines.quantity} + ${quantity}`,
        timesSeen: sql`${posUnmatchedLines.timesSeen} + 1`,
        lastSeenAt: new Date(),
        description: sql`coalesce(${posUnmatchedLines.description}, ${description})`,
      },
    });
}

/**
 * Fetch from a source and import. The only function a route handler or a
 * scheduled job needs to call.
 */
export async function syncFromSource(
  orgId: string,
  source: SalesSource,
  options: { syncedThrough?: Date | null; locationId?: string; connectionId?: string | null } = {},
): Promise<SyncResult & { syncedThrough: Date }> {
  const now = new Date();
  const since = windowSince(options.syncedThrough ?? null, now);

  const fetched = await source.fetchSales({ since, until: now });
  const result = await applyExternalSales(orgId, fetched, options);

  return { ...result, syncedThrough: now };
}
