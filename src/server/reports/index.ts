import { and, asc, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';

import { expiringStock, productStock, products, saleLines, sales, suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { getRatesByBand } from '@/server/settings/vat';
import { grossValue } from '@/server/settings/valuation';

import type { Report } from './csv';

/**
 * Each report returns its own columns alongside its rows, so one table
 * component and one CSV exporter serve all four. The alternative — four pages
 * and four exporters — is the same information written many times over.
 */

export const REPORT_SLUGS = ['stock', 'expiry', 'low-stock', 'sales'] as const;
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
      .orderBy(asc(products.name)),
  );

  return {
    columns: [
      { key: 'name', label: 'product' },
      { key: 'gtin', label: 'barcode' },
      { key: 'quantity', label: 'onHand', numeric: true, format: 'quantity' },
      { key: 'minStock', label: 'minimum', numeric: true, format: 'quantity' },
      { key: 'unit', label: 'unit' },
      { key: 'supplierName', label: 'supplier' },
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
  }
}

export { toCsv } from './csv';
export type { Column, Report } from './csv';
