import { eq, sql } from 'drizzle-orm';

import { UNITS, products, suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { normalizeGtin } from './ean';
import { mapHeaders, parseCsv } from './csv';

export type RowError = { line: number; column: string; message: string };

export type ImportPreview = {
  totalRows: number;
  errors: RowError[];
  /** Rows that would be created, and rows that would update an existing GTIN. */
  toCreate: number;
  toUpdate: number;
  unknownSuppliers: string[];
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
      created: 0,
      updated: 0,
    };
  }

  const index = mapHeaders(rows[0]);
  if (index.name === undefined) {
    return {
      totalRows: rows.length - 1,
      errors: [{ line: 1, column: 'name', message: 'missingNameColumn' }],
      toCreate: 0,
      toUpdate: 0,
      unknownSuppliers: [],
      created: 0,
      updated: 0,
    };
  }

  return withTenant(orgId, async (tx) => {
    const existing = await tx
      .select({ id: products.id, gtin: products.gtin })
      .from(products);
    const byGtin = new Map(existing.filter((p) => p.gtin).map((p) => [p.gtin!, p.id]));

    const supplierRows = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
    const supplierByName = new Map(supplierRows.map((s) => [s.name.trim().toLowerCase(), s.id]));

    const unknownSuppliers = new Set<string>();
    const seenGtins = new Set<string>();
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

      const unit = cell('unit').toLowerCase();
      if (unit && !UNITS.includes(unit as (typeof UNITS)[number])) {
        errors.push({ line, column: 'unit', message: 'invalidUnit' });
        continue;
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

      parsed.push({
        values: {
          organizationId: orgId,
          name,
          gtin,
          caseGtin,
          unitsPerCase,
          sku: cell('sku') || null,
          unit: (unit || 'each') as (typeof UNITS)[number],
          costPrice,
          sellPrice,
          minStock,
          shelfLifeDays,
          supplierId,
        },
        isUpdate: gtin !== null && byGtin.has(gtin),
      });
    }

    const toUpdate = parsed.filter((p) => p.isUpdate).length;
    const preview: ImportPreview = {
      totalRows: rows.length - 1,
      errors,
      toCreate: parsed.length - toUpdate,
      toUpdate,
      unknownSuppliers: [...unknownSuppliers],
    };

    if (errors.length > 0 || options.dryRun || parsed.length === 0) {
      return { ...preview, created: 0, updated: 0 };
    }

    // One statement, inside the tenant transaction: the whole file lands or none
    // of it does. Conflict target is the partial unique index on (org, gtin).
    // ponytail: re-import matching is by unit barcode (gtin) only, same as
    // before this file supported case barcodes. A row with a case barcode but
    // no unit barcode still inserts fresh each time rather than updating in
    // place — upgrade to also match on case_gtin if that's needed.
    await tx
      .insert(products)
      .values(parsed.map((p) => p.values))
      .onConflictDoUpdate({
        target: [products.organizationId, products.gtin],
        targetWhere: sql`${products.gtin} is not null`,
        set: {
          name: sql`excluded.name`,
          sku: sql`excluded.sku`,
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
  'name,barcode,case_barcode,units_per_case,sku,unit,cost,price,min_stock,shelf_life_days,supplier',
  'Vollmilch 1L,4001234567891,14001234567898,12,VM1L,l,0.79,1.29,20,10,Molkerei Nord',
  '"Milch, fettarm 1L",4006381333931,14006381333938,12,MF1L,l,0.75,1.19,20,10,Molkerei Nord',
].join('\n');

/** Used by the products page to tell an empty catalogue apart from a filtered one. */
export async function countProducts(orgId: string) {
  const [row] = await withTenant(orgId, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.isActive, true)),
  );
  return row?.n ?? 0;
}
