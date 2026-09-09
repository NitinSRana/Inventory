import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { UNITS, VAT_BANDS, products, suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { normalizeGtin } from './ean';
import { mapHeaders, parseCsv } from './csv';

export type RowError = { line: number; column: string; message: string };

/**
 * A handful of rows as the importer read them.
 *
 * "12 will be created" proves the file parsed; it proves nothing about whether
 * the right column landed in the right field. Seeing a name, a barcode and a
 * price is what actually catches a semicolon file read as one column, or a
 * price column that mapped to nothing.
 */
export type ImportSampleRow = {
  name: string;
  gtin: string | null;
  sellPrice: string | null;
  isUpdate: boolean;
};

export type ImportPreview = {
  totalRows: number;
  errors: RowError[];
  /** Rows that would be created, and rows that would update an existing GTIN. */
  toCreate: number;
  toUpdate: number;
  unknownSuppliers: string[];
  /** Header columns no alias matched. Ignored during the import, not silently. */
  unknownColumns: string[];
  /** The first few rows as parsed, so the mapping can be eyeballed. */
  sample: ImportSampleRow[];
};

export type ImportResult = ImportPreview & { created: number; updated: number };

const DECIMAL = /^\d+([.,]\d+)?$/;

/**
 * Validates a catalogue file and, if every row is good, writes it.
 *
 * All-or-nothing on purpose. A partial import of a 2,000-line file leaves the
 * owner unable to say what landed and what did not, and re-running it to "catch
 * the rest" is how you get duplicates. One bad row means fix the file and try
 * again — which is how a person with a spreadsheet already thinks.
 *
 * Re-importing the same file is safe: rows match on GTIN and update in place.
 */
export async function importProductsCsv(
  orgId: string,
  text: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportResult> {
  const rows = parseCsv(text);
  const errors: RowError[] = [];

  if (rows.length < 2) {
    return {
      totalRows: 0,
      errors: [{ line: 1, column: 'file', message: 'empty' }],
      toCreate: 0,
      toUpdate: 0,
      unknownSuppliers: [],
      unknownColumns: [],
      sample: [],
      created: 0,
      updated: 0,
    };
  }

  const { index, unknown: unknownColumns } = mapHeaders(rows[0]);
  if (index.name === undefined) {
    return {
      totalRows: rows.length - 1,
      errors: [{ line: 1, column: 'name', message: 'missingNameColumn' }],
      toCreate: 0,
      toUpdate: 0,
      unknownSuppliers: [],
      unknownColumns,
      sample: [],
      created: 0,
      updated: 0,
    };
  }

  return withTenant(orgId, async (tx) => {
    /*
     * Which existing product a row *is*, answered two ways.
     *
     * Matching on barcode alone only ever worked for the products that have
     * one. Roughly two thirds of a real catalogue does not: loose produce, deli
     * counter lines, anything a wholesaler ships without a retail barcode. For
     * those, the shop's own article number is the identifier, and both unique
     * indexes on products already treat it as one.
     */
    const existing = await tx
      .select({ id: products.id, gtin: products.gtin, sku: products.sku })
      .from(products);
    const byGtin = new Map(existing.filter((p) => p.gtin).map((p) => [p.gtin!, p.id]));
    // products_org_sku_uniq guarantees this map cannot collide.
    const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!, p.id]));

    const supplierRows = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
    const supplierByName = new Map(supplierRows.map((s) => [s.name.trim().toLowerCase(), s.id]));

    const unknownSuppliers = new Set<string>();
    const seenGtins = new Set<string>();
    const seenSkus = new Set<string>();
    const seenCaseGtins = new Set<string>();
    const parsed: { values: typeof products.$inferInsert; isUpdate: boolean }[] = [];

    for (let r = 1; r < rows.length; r++) {
      const line = r + 1; // 1-based, and row 1 is the header — matches the spreadsheet.
      const cell = (field: string) => (index[field] !== undefined ? rows[r][index[field]]?.trim() : '') || '';

      const name = cell('name');
      if (!name) {
        errors.push({ line, column: 'name', message: 'required' });
        continue;
      }

      let gtin: string | null = null;
      const rawGtin = cell('gtin');
      if (rawGtin) {
        gtin = normalizeGtin(rawGtin);
        if (!gtin) {
          errors.push({ line, column: 'gtin', message: 'invalidBarcode' });
          continue;
        }
        // A file that lists the same barcode twice would have the second row
        // silently overwrite the first — better to say so.
        if (seenGtins.has(gtin)) {
          errors.push({ line, column: 'gtin', message: 'duplicateInFile' });
          continue;
        }
        seenGtins.add(gtin);
      }

      let caseGtin: string | null = null;
      const rawCaseGtin = cell('caseGtin');
      if (rawCaseGtin) {
        caseGtin = normalizeGtin(rawCaseGtin);
        if (!caseGtin) {
          errors.push({ line, column: 'caseGtin', message: 'invalidCaseBarcode' });
          continue;
        }
        if (seenCaseGtins.has(caseGtin)) {
          errors.push({ line, column: 'caseGtin', message: 'duplicateCaseBarcodeInFile' });
          continue;
        }
        seenCaseGtins.add(caseGtin);
      }

      // Now that a SKU identifies a product, two rows carrying the same one are
      // two claims about one product. Left alone they both resolve to the same
      // id and the whole import dies on a constraint nobody can act on.
      const sku = cell('sku') || null;
      if (sku) {
        if (seenSkus.has(sku)) {
          errors.push({ line, column: 'sku', message: 'duplicateSkuInFile' });
          continue;
        }
        seenSkus.add(sku);
      }

      const unit = cell('unit').toLowerCase();
      if (unit && !UNITS.includes(unit as (typeof UNITS)[number])) {
        errors.push({ line, column: 'unit', message: 'invalidUnit' });
        continue;
      }

      /*
       * VAT band. Omitted means zero-rated, matching the column default and the
       * fact that most UK food is zero-rated. A wrong 'zero' under-declares on a
       * minority of lines; a wrong 'standard' overcharges the customer on the
       * majority — so the quiet default is the forgiving one.
       */
      const vatBandRaw = cell('vatBand').toLowerCase().replace(/[\s-]+/g, '_');
      let vatBand: (typeof VAT_BANDS)[number] = 'zero';
      if (vatBandRaw) {
        if (!VAT_BANDS.includes(vatBandRaw as (typeof VAT_BANDS)[number])) {
          errors.push({ line, column: 'vatBand', message: 'invalidVatBand' });
          continue;
        }
        vatBand = vatBandRaw as (typeof VAT_BANDS)[number];
      }

      // Numerics stay strings all the way to the database. Commas become dots so
      // a German-formatted "1,29" does not silently import as null.
      const numeric = (field: string): string | null => {
        const raw = cell(field);
        if (!raw) return null;
        if (!DECIMAL.test(raw)) {
          errors.push({ line, column: field, message: 'notANumber' });
          return null;
        }
        return raw.replace(',', '.');
      };

      const costPrice = numeric('costPrice');
      const sellPrice = numeric('sellPrice');
      const minStock = numeric('minStock');
      const unitsPerCase = numeric('unitsPerCase');
      const shelfLifeRaw = cell('shelfLifeDays');
      let shelfLifeDays: number | null = null;
      if (shelfLifeRaw) {
        if (!/^\d+$/.test(shelfLifeRaw)) {
          errors.push({ line, column: 'shelfLifeDays', message: 'notAWholeNumber' });
          continue;
        }
        shelfLifeDays = Number(shelfLifeRaw);
      }

      let supplierId: string | null = null;
      const supplierName = cell('supplier');
      if (supplierName) {
        supplierId = supplierByName.get(supplierName.toLowerCase()) ?? null;
        if (!supplierId) {
          unknownSuppliers.add(supplierName);
          errors.push({ line, column: 'supplier', message: 'unknownSupplier' });
          continue;
        }
      }

      /*
       * Barcode first, then SKU. The barcode is the stronger claim — it is the
       * thing that gets scanned at the till — so when a row's two identifiers
       * point at different products, it decides. Resolving here rather than
       * leaving it to ON CONFLICT is what lets one statement handle both.
       */
      const matchedId = (gtin !== null ? byGtin.get(gtin) : undefined) ?? (sku ? bySku.get(sku) : undefined);

      // The barcode matched one product while the SKU still belongs to another.
      // Moving an article number between products silently is not something a
      // spreadsheet should be able to do by accident, and letting it through
      // kills the whole import on a constraint with no line number attached.
      if (sku && matchedId !== undefined && bySku.has(sku) && bySku.get(sku) !== matchedId) {
        errors.push({ line, column: 'sku', message: 'skuOnAnotherProduct' });
        continue;
      }

      parsed.push({
        values: {
          // Minted for a new product rather than defaulted, so every row can go
          // through the same upsert on the primary key.
          id: matchedId ?? randomUUID(),
          organizationId: orgId,
          name,
          gtin,
          caseGtin,
          unitsPerCase,
          sku,
          unit: (unit || 'each') as (typeof UNITS)[number],
          costPrice,
          sellPrice,
          vatBand,
          minStock,
          shelfLifeDays,
          supplierId,
        },
        isUpdate: matchedId !== undefined,
      });
    }

    const toUpdate = parsed.filter((p) => p.isUpdate).length;
    const preview: ImportPreview = {
      totalRows: rows.length - 1,
      errors,
      toCreate: parsed.length - toUpdate,
      toUpdate,
      unknownSuppliers: [...unknownSuppliers],
      unknownColumns,
      sample: parsed.slice(0, 5).map((p) => ({
        name: p.values.name,
        gtin: p.values.gtin ?? null,
        sellPrice: p.values.sellPrice ?? null,
        isUpdate: p.isUpdate,
      })),
    };

    if (errors.length > 0 || options.dryRun || parsed.length === 0) {
      return { ...preview, created: 0, updated: 0 };
    }

    // One statement, inside the tenant transaction: the whole file lands or none
    // of it does. The conflict target is the primary key, because which product
    // a row belongs to was already decided above — by barcode, then by SKU.
    // ponytail: case barcode is still not an identifier. A row carrying only a
    // case barcode inserts fresh each time; add it to the resolution above if a
    // wholesaler file ever ships that way.
    await tx
      .insert(products)
      .values(parsed.map((p) => p.values))
      .onConflictDoUpdate({
        target: products.id,
        set: {
          name: sql`excluded.name`,
          sku: sql`excluded.sku`,
          // Coalesced, unlike every other column: a file with no barcode column
          // at all is silent about barcodes, not an instruction to delete the
          // ones already there. Reachable only now that a row without a barcode
          // can match an existing product.
          gtin: sql`coalesce(excluded.gtin, ${products.gtin})`,
          caseGtin: sql`excluded.case_gtin`,
          unitsPerCase: sql`excluded.units_per_case`,
          unit: sql`excluded.unit`,
          costPrice: sql`excluded.cost_price`,
          sellPrice: sql`excluded.sell_price`,
          minStock: sql`excluded.min_stock`,
          shelfLifeDays: sql`excluded.shelf_life_days`,
          supplierId: sql`excluded.supplier_id`,
          isActive: sql`true`,
        },
      });

    return { ...preview, created: preview.toCreate, updated: toUpdate };
  });
}

/**
 * The downloadable template.
 *
 * The example barcodes are real EAN-13s with correct check digits — a template
 * that fails its own validator on first import is worse than no template. The
 * second row shows a quoted comma, which is the format's one real trap.
 */
export const TEMPLATE_CSV = [
  'name,barcode,case_barcode,units_per_case,sku,unit,cost,price,vat_band,min_stock,shelf_life_days,supplier',
  // Zero-rated: ordinary food, which is most of a shop.
  'Semi-Skimmed Milk 2L,5000112637922,15000112637929,6,MILK2L,l,0.85,1.45,zero,20,7,Dairy Direct',
  // Standard-rated: confectionery is the exception that catches people out.
  'Chocolate Bar 45g,5000159484695,15000159484692,48,CHOC45,each,0.42,0.85,standard,24,180,Sweet Supplies',
  // A quoted comma, which is the format's one real trap.
  '"Bread, Wholemeal 800g",5012345678900,15012345678907,10,BRD800,each,0.62,1.25,zero,15,5,Bakery Co',
].join('\n');

/** Used by the products page to tell an empty catalogue apart from a filtered one. */
export async function countProducts(orgId: string) {
  const [row] = await withTenant(orgId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.isActive, true)),
  );
  return row?.n ?? 0;
}
