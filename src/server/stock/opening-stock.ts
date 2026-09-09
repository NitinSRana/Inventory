import Decimal from 'decimal.js';
import { eq, inArray, or } from 'drizzle-orm';

import { locations, products } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { dateParam } from '@/lib/search-params';
import { OPENING_STOCK_COLUMNS, mapColumns, parseCsv } from '@/server/catalog/csv';
import { normalizeGtin } from '@/server/catalog/ean';
import type { RowError } from '@/server/catalog/import';
import { receiveStock } from '@/server/stock/movements';

/**
 * What is on the shelf on day one.
 *
 * The catalogue import answers "what does this shop sell". Nothing answered
 * "and how much of it is there right now", so a shop with 2,000 products had to
 * count every one of them into the Receive screen by hand before any number in
 * the app meant anything. `CLAUDE.md` names that as the unsolved onboarding
 * problem, and this is the half of it a spreadsheet can solve.
 *
 * Rows are receipts, not counts: they post `receipt` movements against the
 * ledger exactly as a delivery does, because on day one there is no prior
 * balance for a count to be a variance against.
 */

/**
 * ponytail: a hard row cap. `findOrCreateBatch` does a select then an insert per
 * row, so this is ~1,000 round trips at the ceiling — seconds, not a timeout,
 * but a 5,000-row file would be one. Batch the batch lookup before raising it.
 */
export const MAX_OPENING_ROWS = 500;

const DECIMAL = /^\d+([.,]\d+)?$/;

export type OpeningStockPreview = {
  totalRows: number;
  errors: RowError[];
  unknownColumns: string[];
  /** Rows that would post, and what they add up to — the number to sanity-check. */
  toReceive: number;
  sample: { name: string; quantity: string; expiryDate: string | null }[];
};

export type OpeningStockResult = OpeningStockPreview & { received: number };

const fail = (
  totalRows: number,
  errors: RowError[],
  unknownColumns: string[] = [],
): OpeningStockResult => ({
  totalRows,
  errors,
  unknownColumns,
  toReceive: 0,
  sample: [],
  received: 0,
});

/**
 * Validates the whole file, then writes it in one transaction or not at all.
 *
 * Same contract as the catalogue import, for the same reason: a half-applied
 * opening balance is worse than none, because nobody can say afterwards which
 * half landed, and re-running it doubles what did.
 */
export async function importOpeningStockCsv(
  orgId: string,
  text: string,
  options: { dryRun?: boolean; actorId?: string | null } = {},
): Promise<OpeningStockResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return fail(0, [{ line: 1, column: 'file', message: 'empty' }]);

  const { index, unknown: unknownColumns } = mapColumns(rows[0], OPENING_STOCK_COLUMNS);
  if (index.gtin === undefined && index.sku === undefined) {
    return fail(
      rows.length - 1,
      [{ line: 1, column: 'gtin', message: 'missingProductColumn' }],
      unknownColumns,
    );
  }
  if (index.quantity === undefined) {
    return fail(
      rows.length - 1,
      [{ line: 1, column: 'quantity', message: 'missingQuantityColumn' }],
      unknownColumns,
    );
  }
  if (rows.length - 1 > MAX_OPENING_ROWS) {
    return fail(
      rows.length - 1,
      [{ line: 1, column: 'file', message: 'tooManyRows' }],
      unknownColumns,
    );
  }

  return withTenant(orgId, async (tx) => {
    // One lookup for the whole file. Resolving each row through
    // findProductByBarcode would open its own transaction per row, which is 500
    // transactions for a file a person thinks of as one action.
    const wanted = new Set<string>();
    for (let r = 1; r < rows.length; r++) {
      for (const field of ['gtin', 'sku'] as const) {
        const i = index[field];
        const raw = i === undefined ? '' : (rows[r][i]?.trim() ?? '');
        if (raw) wanted.add(field === 'gtin' ? (normalizeGtin(raw) ?? raw) : raw);
      }
    }
    const catalogue = wanted.size
      ? await tx
          .select({
            id: products.id,
            name: products.name,
            gtin: products.gtin,
            sku: products.sku,
            dateType: products.dateType,
          })
          .from(products)
          .where(
            or(
              inArray(products.gtin, [...wanted]),
              inArray(products.sku, [...wanted]),
            ),
          )
      : [];
    const byGtin = new Map(catalogue.filter((p) => p.gtin).map((p) => [p.gtin!, p]));
    const bySku = new Map(catalogue.filter((p) => p.sku).map((p) => [p.sku!, p]));

    // Resolved once rather than per row: receiveStock would otherwise re-query
    // the default location 500 times inside this same transaction.
    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.isDefault, true))
      .limit(1);
    if (!location) return fail(rows.length - 1, [{ line: 1, column: 'file', message: 'noLocation' }]);

    const errors: RowError[] = [];
    const parsed: {
      productId: string;
      name: string;
      quantity: string;
      expiryDate: string | null;
      lotNumber: string | null;
      unitCost: string | null;
      dateType: (typeof catalogue)[number]['dateType'];
    }[] = [];
    // Two lines for the same batch are fine and simply add up — unless they
    // disagree about what it cost, because only the first cost is ever stored
    // and the second would vanish without a word.
    const costByBatch = new Map<string, string | null>();

    for (let r = 1; r < rows.length; r++) {
      const line = r + 1; // 1-based, and row 1 is the header — matches the spreadsheet.
      const cell = (field: string) =>
        (index[field] !== undefined ? rows[r][index[field]]?.trim() : '') || '';

      const rawGtin = cell('gtin');
      const rawSku = cell('sku');
      let product: (typeof catalogue)[number] | undefined;
      if (rawGtin) {
        const gtin = normalizeGtin(rawGtin);
        if (!gtin) {
          errors.push({ line, column: 'gtin', message: 'invalidBarcode' });
          continue;
        }
        product = byGtin.get(gtin);
      }
      if (!product && rawSku) product = bySku.get(rawSku);
      if (!product) {
        // Deliberately not creating one: a product invented from a stock file
        // has no price and no VAT band, so the till could not sell it anyway.
        errors.push({ line, column: 'gtin', message: 'unknownProduct' });
        continue;
      }

      const rawQuantity = cell('quantity');
      if (!DECIMAL.test(rawQuantity)) {
        errors.push({ line, column: 'quantity', message: 'notANumber' });
        continue;
      }
      const quantity = rawQuantity.replace(',', '.');
      if (new Decimal(quantity).lessThanOrEqualTo(0)) {
        // Zero is not an error worth failing a file over, but it is not a
        // receipt either — a product with none of it on the shelf is what an
        // empty ledger already says.
        continue;
      }

      let expiryDate: string | null = null;
      const rawExpiry = cell('expiryDate');
      if (rawExpiry) {
        // ISO only. A guesser cannot tell 03/04/2026 apart in two countries that
        // both use this app, and guessing wrong writes a wrong expiry date onto
        // real stock — which is the one number the whole product exists to get right.
        expiryDate = dateParam(rawExpiry) ?? null;
        if (!expiryDate) {
          errors.push({ line, column: 'expiryDate', message: 'notADate' });
          continue;
        }
      }

      const lotNumber = cell('lotNumber') || null;

      let unitCost: string | null = null;
      const rawCost = cell('unitCost');
      if (rawCost) {
        if (!DECIMAL.test(rawCost)) {
          errors.push({ line, column: 'unitCost', message: 'notANumber' });
          continue;
        }
        unitCost = rawCost.replace(',', '.');
      }

      const key = `${product.id}|${expiryDate ?? ''}|${lotNumber ?? ''}`;
      if (costByBatch.has(key) && costByBatch.get(key) !== unitCost) {
        errors.push({ line, column: 'unitCost', message: 'conflictingCost' });
        continue;
      }
      costByBatch.set(key, unitCost);

      parsed.push({
        productId: product.id,
        name: product.name,
        quantity,
        expiryDate,
        lotNumber,
        unitCost,
        dateType: product.dateType,
      });
    }

    const preview: OpeningStockPreview = {
      totalRows: rows.length - 1,
      errors,
      unknownColumns,
      toReceive: parsed.length,
      sample: parsed.slice(0, 5).map((p) => ({
        name: p.name,
        quantity: p.quantity,
        expiryDate: p.expiryDate,
      })),
    };

    if (errors.length > 0 || options.dryRun || parsed.length === 0) {
      return { ...preview, received: 0 };
    }

    for (const row of parsed) {
      await receiveStock(
        orgId,
        {
          productId: row.productId,
          locationId: location.id,
          quantity: row.quantity,
          expiryDate: row.expiryDate,
          lotNumber: row.lotNumber,
          unitCost: row.unitCost,
          // From the catalogue, never from the file: whether a date is a use-by
          // or a best-before decides whether the till refuses to sell past it.
          dateType: row.dateType,
          actorId: options.actorId ?? null,
          note: 'Opening stock',
        },
        tx,
      );
    }

    return { ...preview, received: parsed.length };
  });
}

/**
 * The downloadable template.
 *
 * Barcodes match the catalogue template's, so the two files line up if someone
 * imports both — a template whose rows reference nothing would fail its own
 * validator on first use.
 */
export const OPENING_STOCK_TEMPLATE_CSV = [
  'barcode,sku,quantity,expiry_date,lot,unit_cost',
  '5000112637922,MILK2L,24,2026-09-16,L2409,0.85',
  '5000159484695,CHOC45,96,2027-03-08,,0.42',
  '5012345678900,BRD800,15,2026-09-14,,0.62',
].join('\n');
