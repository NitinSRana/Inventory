import { and, asc, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';

import {
  expiringStock,
  organizationMembers,
  productStock,
  products,
  saleLines,
  sales,
  stockMovements,
  suppliers,
} from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { SALE_OCCURRED } from '@/server/pos/checkout';
import { getRatesByBand } from '@/server/settings/vat';
import { grossValue } from '@/server/settings/valuation';

import type { Report } from './csv';

/**
 * Each report returns its own columns alongside its rows, so one table
 * component and one CSV exporter serve all four. The alternative — four pages
 * and four exporters — is the same information written many times over.
 */

export const REPORT_SLUGS = [
  'stock',
  'expiry',
  'low-stock',
  'sales',
  'vat',
  'corrections',
] as const;
export type ReportSlug = (typeof REPORT_SLUGS)[number];

/** Stock on hand and what it is worth. */
async function stockOnHand(orgId: string): Promise<Report> {
  const rates = await getRatesByBand(orgId);
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        quantity: sql<string>`coalesce(${productStock.quantity}, '0')::text`,
        costPrice: products.costPrice,
        vatBand: products.vatBand,
        // Rounded here, not in the component: the CSV export reads the same rows,
        // and 19.2000000 in a spreadsheet is as unhelpful as it is on screen.
        value: sql<string>`round(coalesce(${productStock.quantity}, 0) * coalesce(${products.costPrice}, 0), 2)::text`,
      })
      .from(products)
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .where(eq(products.isActive, true))
      .orderBy(desc(sql`coalesce(${productStock.quantity}, 0) * coalesce(${products.costPrice}, 0)`)),
  );

  return {
    columns: [
      { key: 'name', label: 'product' },
      { key: 'gtin', label: 'barcode' },
      { key: 'quantity', label: 'onHand', numeric: true, format: 'quantity' },
      { key: 'unit', label: 'unit' },
      { key: 'costPrice', label: 'unitCost', numeric: true, format: 'money' },
      { key: 'value', label: 'value', numeric: true, format: 'money' },
      { key: 'grossValue', label: 'grossValue', numeric: true, format: 'money' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      gtin: r.gtin ?? '',
      quantity: r.quantity,
      unit: r.unit,
      costPrice: r.costPrice ?? '',
      value: r.value,
      // Valuation only — this is not an invoice. Bands come from the tenant's
      // own vat_rates rows, never a hardcoded country rate.
      grossValue: grossValue(r.value, rates[r.vatBand] ?? '0'),
    })),
  };
}

/** Money sitting in stock that is about to stop being sellable. */
async function expiryExposure(orgId: string, days: number): Promise<Report> {
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select()
      .from(expiringStock)
      .where(sql`${expiringStock.daysRemaining} <= ${days}`)
      .orderBy(asc(expiringStock.daysRemaining), desc(expiringStock.valueAtRisk)),
  );

  return {
    columns: [
      { key: 'productName', label: 'product' },
      { key: 'expiryDate', label: 'expires' },
      { key: 'daysRemaining', label: 'daysLeft', numeric: true },
      { key: 'lotNumber', label: 'lot' },
      { key: 'quantity', label: 'quantity', numeric: true, format: 'quantity' },
      { key: 'valueAtRisk', label: 'valueAtRisk', numeric: true, format: 'money' },
    ],
    rows: rows.map((r) => ({
      productName: r.productName ?? '',
      expiryDate: r.expiryDate ?? '',
      daysRemaining: String(r.daysRemaining ?? ''),
      lotNumber: r.lotNumber ?? '',
      quantity: r.quantity ?? '0',
      valueAtRisk: r.valueAtRisk ? Number(r.valueAtRisk).toFixed(2) : '0.00',
    })),
  };
}

/** Products at or under their minimum. */
async function lowStock(orgId: string): Promise<Report> {
  const onHand = sql`coalesce(${productStock.quantity}, 0)`;
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        quantity: sql<string>`${onHand}::text`,
        minStock: products.minStock,
        supplierName: suppliers.name,
      })
      .from(products)
      .leftJoin(productStock, eq(productStock.productId, products.id))
      .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
      .where(
        and(eq(products.isActive, true), isNotNull(products.minStock), lt(onHand, products.minStock)),
      )
      // Grouped by supplier, because that is how the list gets acted on: one
      // phone call covers everything that comes from one place. Products with
      // no supplier sort last — they are the ones nobody can be called about.
      .orderBy(sql`${suppliers.name} asc nulls last`, asc(products.name)),
  );

  return {
    columns: [
      { key: 'supplierName', label: 'supplier' },
      { key: 'name', label: 'product' },
      { key: 'gtin', label: 'barcode' },
      { key: 'quantity', label: 'onHand', numeric: true, format: 'quantity' },
      { key: 'minStock', label: 'minimum', numeric: true, format: 'quantity' },
      { key: 'unit', label: 'unit' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      gtin: r.gtin ?? '',
      quantity: r.quantity,
      minStock: r.minStock ?? '',
      unit: r.unit,
      supplierName: r.supplierName ?? '',
    })),
  };
}

/** What sold, by product, and what it brought in — completed sales only. */
async function salesByProduct(orgId: string, days: number): Promise<Report> {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        name: products.name,
        gtin: products.gtin,
        unit: products.unit,
        quantity: sql<string>`sum(${saleLines.quantity})::text`,
        vat: sql<string>`round(sum(${saleLines.vatAmount}), 2)::text`,
        // Gross, the number a shopkeeper actually recognises as "what came in".
        grossRevenue: sql<string>`round(sum(${saleLines.lineTotal}), 2)::text`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .innerJoin(products, eq(products.id, saleLines.productId))
      .where(and(eq(sales.status, 'completed'), gte(sales.createdAt, since)))
      .groupBy(products.id, products.name, products.gtin, products.unit)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`)),
  );

  return {
    columns: [
      { key: 'name', label: 'product' },
      { key: 'gtin', label: 'barcode' },
      { key: 'quantity', label: 'quantity', numeric: true, format: 'quantity' },
      { key: 'unit', label: 'unit' },
      { key: 'vat', label: 'vat', numeric: true, format: 'money' },
      { key: 'grossRevenue', label: 'grossRevenue', numeric: true, format: 'money' },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      gtin: r.gtin ?? '',
      quantity: r.quantity,
      unit: r.unit,
      vat: r.vat,
      grossRevenue: r.grossRevenue,
    })),
  };
}

/**
 * VAT collected, by band — the numbers a return is filled in from.
 *
 * Every figure is summed from what was stored on the line at the moment of
 * sale. Nothing here reads `vat_rates`: a shop that corrects a band's rate
 * today must not see last quarter's takings silently restated, and a period
 * spanning a rate change must show what was actually charged on both sides
 * of it.
 *
 * VAT is the stored remainder, so net is `gross - vat` rather than anything
 * recomputed — `net + vat` reconstructs the gross the customer paid, to the
 * penny, which is the only property a return cares about.
 */
async function vatByBand(orgId: string, days: number): Promise<Report> {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        vatBand: saleLines.vatBand,
        lines: sql<number>`count(*)::int`,
        net: sql<string>`round(sum(${saleLines.lineTotal} - ${saleLines.vatAmount}), 2)::text`,
        vat: sql<string>`round(sum(${saleLines.vatAmount}), 2)::text`,
        // Built from the two rounded halves rather than rounded separately, so
        // net + VAT reconstructs the gross on screen to the penny. Rounding
        // three exact sums independently can leave the row a cent short of
        // itself, on a page someone copies figures off into a return.
        gross: sql<string>`(round(sum(${saleLines.lineTotal} - ${saleLines.vatAmount}), 2)
          + round(sum(${saleLines.vatAmount}), 2))::text`,
        // Derived, not stored, and deliberately shown: it is the only honest
        // rate available, and it reads as a blended figure exactly when it is
        // one — a period in which a band's rate moved.
        effectiveRate: sql<string>`case
          when sum(${saleLines.lineTotal} - ${saleLines.vatAmount}) = 0 then ''
          else round(100 * sum(${saleLines.vatAmount}) / sum(${saleLines.lineTotal} - ${saleLines.vatAmount}), 1)::text
        end`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      // Voided sales keep their lines. Counting them would over-declare.
      // The bound value is an ISO string with an explicit cast: a raw SQL
      // expression carries no column type for the driver to map a Date through.
      .where(
        and(
          eq(sales.status, 'completed'),
          sql`${SALE_OCCURRED} >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .groupBy(saleLines.vatBand)
      .orderBy(desc(sql`sum(${saleLines.vatAmount})`)),
  );

  return {
    columns: [
      { key: 'vatBand', label: 'vatBand', format: 'vatBand' },
      { key: 'lines', label: 'lines', numeric: true },
      { key: 'net', label: 'net', numeric: true, format: 'money' },
      { key: 'vat', label: 'vat', numeric: true, format: 'money' },
      { key: 'gross', label: 'grossRevenue', numeric: true, format: 'money' },
      { key: 'effectiveRate', label: 'effectiveRate', numeric: true },
    ],
    rows: rows.map((r) => ({
      vatBand: r.vatBand,
      lines: String(r.lines),
      net: r.net,
      vat: r.vat,
      gross: r.gross,
      effectiveRate: r.effectiveRate,
    })),
  };
}

/**
 * Every hand-made change to the ledger, and who made it.
 *
 * One query, no union: `voidSale` already posts its reversals as
 * `manual_adjustment` rows carrying `reference_type = 'sale'`, so corrections
 * and voids are the same shape in the same table and only the reference tells
 * them apart. That is also why this is a report rather than a screen — the
 * period picker and the CSV export come free, and an auditor asking "what did
 * you change last quarter" wants a file.
 */
async function corrections(orgId: string, days: number): Promise<Report> {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await withTenant(orgId, (tx) =>
    tx
      .select({
        occurredAt: stockMovements.occurredAt,
        productName: products.name,
        quantityDelta: stockMovements.quantityDelta,
        unit: products.unit,
        // Written by whoever made the correction, and the whole reason a
        // required reason is worth requiring.
        note: stockMovements.note,
        saleNumber: sales.saleNumber,
        actorName: organizationMembers.displayName,
        actorId: stockMovements.actorId,
      })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      // Only some corrections reverse a sale, and a member may have been
      // removed since — both joins have to be left joins or those rows vanish
      // from the audit log, which is the one place they must not.
      .leftJoin(sales, eq(sales.id, stockMovements.referenceId))
      .leftJoin(organizationMembers, eq(organizationMembers.userId, stockMovements.actorId))
      .where(
        and(
          eq(stockMovements.movementType, 'manual_adjustment'),
          gte(stockMovements.occurredAt, since),
        ),
      )
      .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id)),
  );

  return {
    columns: [
      { key: 'occurredAt', label: 'when' },
      { key: 'productName', label: 'product' },
      { key: 'quantityDelta', label: 'change', numeric: true, format: 'quantity' },
      { key: 'unit', label: 'unit' },
      { key: 'saleNumber', label: 'sale' },
      { key: 'actor', label: 'who' },
      { key: 'note', label: 'reason' },
    ],
    rows: rows.map((r) => ({
      occurredAt: r.occurredAt.toISOString().slice(0, 10),
      productName: r.productName,
      quantityDelta: r.quantityDelta,
      unit: r.unit,
      saleNumber: r.saleNumber ?? '',
      // The name if there is one, the id if there is not, and blank for a
      // movement nobody was recorded against — never a made-up person.
      actor: r.actorName ?? (r.actorId ? r.actorId.slice(0, 8) : ''),
      note: r.note ?? '',
    })),
  };
}

export function buildReport(orgId: string, slug: ReportSlug, days: number): Promise<Report> {
  switch (slug) {
    case 'stock':
      return stockOnHand(orgId);
    case 'expiry':
      return expiryExposure(orgId, days);
    case 'low-stock':
      return lowStock(orgId);
    case 'sales':
      return salesByProduct(orgId, days);
    case 'vat':
      return vatByBand(orgId, days);
    case 'corrections':
      return corrections(orgId, days);
  }
}

export { toCsv } from './csv';
export type { Column, Report } from './csv';
