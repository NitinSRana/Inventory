import Decimal from 'decimal.js';
import { asc, eq, sql } from 'drizzle-orm';

import { consumptionRates, onOrderQuantities, productStock, products, suppliers } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getLivePosRates } from '@/server/consumption/posRate';
import { suggestedOrderQuantity } from '@/server/consumption/rate';

export type Suggestion = {
  productId: string;
  productName: string;
  gtin: string | null;
  unit: string;
  onHand: string;
  onOrder: string;
  dailyRate: string | null;
  confidence: string | null;
  suggestedQuantity: string;
  costPrice: string | null;
};

export type SupplierSuggestions = {
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number;
  minOrderValue: string | null;
  lines: Suggestion[];
  /** Estimated cost of the whole group, so a minimum order value is checkable. */
  estimatedTotal: string;
};

/**
 * What to order, grouped by supplier.
 *
 * Rate times lead time plus a safety buffer, minus stock on hand and quantities
 * already on open purchase orders. No forecasting — the spec is explicit about
 * that, and a grocer can check this arithmetic by hand.
 *
 * Products without a consumption rate are omitted rather than guessed at. A
 * suggestion built on no data is worse than no suggestion.
 */
export type ReorderReport = {
  groups: SupplierSuggestions[];
  /**
   * Active products with no consumption rate yet. Surfaced rather than hidden:
   * "we can't advise on 40 of your products" is information the owner needs,
   * and silence would read as "nothing to order".
   */
  withoutRate: number;
};

export async function getReorderSuggestions(orgId: string): Promise<ReorderReport> {
  // Two round trips, not one: the count-window rate is a plain join, the POS
  // rate is a trailing-window aggregate best kept as its own query rather than
  // folded into an already-wide multi-join select.
  const [rows, posRates] = await Promise.all([
    withTenant(orgId, (tx) =>
      tx
        .select({
          productId: products.id,
          productName: products.name,
          gtin: products.gtin,
          unit: products.unit,
          costPrice: products.costPrice,
          minStock: products.minStock,
          supplierId: suppliers.id,
          supplierName: suppliers.name,
          leadTimeDays: suppliers.leadTimeDays,
          minOrderValue: suppliers.minOrderValue,
          onHand: sql<string>`coalesce(${productStock.quantity}, '0')::text`,
          onOrder: sql<string>`coalesce(${onOrderQuantities.quantityOnOrder}, '0')::text`,
          dailyRate: consumptionRates.dailyRate,
          confidence: consumptionRates.confidence,
        })
        .from(products)
        .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
        .leftJoin(productStock, eq(productStock.productId, products.id))
        .leftJoin(onOrderQuantities, eq(onOrderQuantities.productId, products.id))
        .leftJoin(consumptionRates, eq(consumptionRates.productId, products.id))
        .where(eq(products.isActive, true))
        .orderBy(asc(suppliers.name), asc(products.name)),
    ),
    getLivePosRates(orgId),
  ]);

  const groups = new Map<string, SupplierSuggestions>();
  let withoutRate = 0;

  for (const r of rows) {
    // Real sales beat an inference from two counts a fortnight apart, so a
    // product with POS history uses that instead of the count-window table —
    // never both, or the two would be double-counting the same depletion.
    const pos = posRates.get(r.productId);
    const dailyRate = pos?.dailyRate ?? r.dailyRate;
    const confidence = pos?.confidence ?? r.confidence;

    if (dailyRate === null) withoutRate += 1;

    const quantity = suggestedOrderQuantity({
      dailyRate,
      leadTimeDays: r.leadTimeDays ?? 3,
      onHand: r.onHand,
      onOrder: r.onOrder,
      minStock: r.minStock,
    });
    if (!quantity) continue;

    const key = r.supplierId ?? 'none';
    const group =
      groups.get(key) ??
      ({
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        leadTimeDays: r.leadTimeDays ?? 3,
        minOrderValue: r.minOrderValue,
        lines: [],
        estimatedTotal: '0',
      } satisfies SupplierSuggestions);

    group.lines.push({
      productId: r.productId,
      productName: r.productName,
      gtin: r.gtin,
      unit: r.unit,
      onHand: r.onHand,
      onOrder: r.onOrder,
      dailyRate,
      confidence,
      suggestedQuantity: quantity,
      costPrice: r.costPrice,
    });
    groups.set(key, group);
  }

  // Decimal arithmetic, same as everywhere else money is touched.
  for (const group of groups.values()) {
    group.estimatedTotal = group.lines
      .reduce(
        (acc, l) => acc.plus(new Decimal(l.suggestedQuantity).times(l.costPrice ?? 0)),
        new Decimal(0),
      )
      .toDecimalPlaces(2)
      .toString();
  }

  return { groups: [...groups.values()], withoutRate };
}
