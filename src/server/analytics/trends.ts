import { and, desc, eq, gt, gte, lt, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';

import { batches, productStock, products, saleLines, sales, stockMovements } from '@/db/schema';
import { withTenant } from '@/db/tenant';

/**
 * The shapes behind the charts.
 *
 * Every series is generated from a date spine rather than from the rows that
 * happen to exist. A day with no sales is a real and interesting fact — a
 * closed Sunday, a till nobody used — and a series that simply omits it draws
 * a line straight over the gap and quietly lies about the trend.
 *
 * Money stays a string all the way out, as everywhere else. The charts scale
 * bars by ratio, which is the one place a float is harmless: it decides a pixel
 * height, never a figure anyone reads.
 */

export type DayPoint = { day: string; value: string };

/**
 * A window of whole days, and the same window shifted back.
 *
 * `periodsAgo: 1` is the comparison period: a figure on its own says almost
 * nothing — six thousand in takings is either a good month or a collapse — and
 * the only cheap way to tell is the month before it.
 */
export type Window = { from: Date; to: Date };

export function windowFor(days: number, periodsAgo = 0): Window {
  const day = 86_400_000;
  const to = new Date(Date.now() - periodsAgo * days * day);
  return { from: new Date(to.getTime() - days * day), to };
}

/** Gross takings per day, oldest first, including the days with none. */
export async function dailyRevenue(orgId: string, days = 30): Promise<DayPoint[]> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx.execute(sql`
      with spine as (
        select generate_series(
          current_date - make_interval(days => ${days - 1}),
          current_date,
          interval '1 day'
        )::date as day
      )
      select
        spine.day::text as day,
        coalesce(round(sum(${sales.total}), 2), 0)::text as value
      from spine
      left join ${sales}
        on ${sales.createdAt}::date = spine.day
       and ${sales.status} = 'completed'
      group by spine.day
      order by spine.day
    `);
    return rows as unknown as DayPoint[];
  });
}

export type NamedValue = { label: string; value: string };

/** The few products that actually earn, biggest first. */
export async function topProductsByRevenue(orgId: string, days = 30, limit = 5) {
  const since = new Date(Date.now() - days * 86_400_000);
  return withTenant(orgId, (tx) =>
    tx
      .select({
        label: products.name,
        value: sql<string>`round(sum(${saleLines.lineTotal}), 2)::text`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .innerJoin(products, eq(products.id, saleLines.productId))
      .where(and(eq(sales.status, 'completed'), gte(sales.createdAt, since)))
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`))
      .limit(limit),
  );
}

/**
 * What's sitting on the shelf worth the most right now — a different question
 * from "what sold": a display ranking at shelf price, not a ledger or
 * accounting figure, so this is deliberately not net-of-VAT the way margin is.
 */
export async function topProductsByStockValue(orgId: string, limit = 5) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        label: products.name,
        value: sql<string>`round(sum(${productStock.quantity} * coalesce(${products.sellPrice}, 0)), 2)::text`,
      })
      .from(productStock)
      .innerJoin(products, eq(products.id, productStock.productId))
      .groupBy(products.id, products.name)
      .orderBy(desc(sql`sum(${productStock.quantity} * coalesce(${products.sellPrice}, 0))`))
      .limit(limit),
  );
}

export type Margin = {
  /** Gross takings, what a shopkeeper recognises as "what came in". */
  revenue: string;
  /** What those specific units cost. */
  cogs: string;
  margin: string;
};

/**
 * Takings, cost of goods sold, and the difference.
 *
 * The cost comes from the **ledger**, not from `products.cost_price`. Checkout
 * writes one consumption movement per FEFO batch allocation, and a batch carries
 * the price that batch was bought at — so this is what the units that left the
 * shelf actually cost, not what the same product costs to buy today. On a
 * product whose price moved last week those are different numbers, and only one
 * of them is the margin the shop earned.
 *
 * `batches.unit_cost` falls back to the product's cost for stock received before
 * anyone filled it in; without the fallback that stock would look free and the
 * margin would flatter itself.
 */
export async function grossMargin(orgId: string, window: Window): Promise<Margin> {
  return withTenant(orgId, async (tx) => {
    const [revenueRow] = await tx
      .select({ total: sql<string>`coalesce(round(sum(${sales.total}), 2), 0)::text` })
      .from(sales)
      .where(
        and(
          eq(sales.status, 'completed'),
          gte(sales.createdAt, window.from),
          lt(sales.createdAt, window.to),
        ),
      );

    const [cogsRow] = await tx
      .select({
        total: sql<string>`coalesce(round(abs(sum(
          ${stockMovements.quantityDelta} * coalesce(${batches.unitCost}, ${products.costPrice}, 0)
        )), 2), 0)::text`,
      })
      .from(stockMovements)
      .leftJoin(batches, eq(batches.id, stockMovements.batchId))
      .leftJoin(products, eq(products.id, stockMovements.productId))
      .where(
        and(
          eq(stockMovements.movementType, 'consumption'),
          gte(stockMovements.occurredAt, window.from),
          lt(stockMovements.occurredAt, window.to),
        ),
      );

    const revenue = revenueRow?.total ?? '0';
    const cogs = cogsRow?.total ?? '0';
    return {
      revenue,
      cogs,
      // Decimal: this is money, and the two halves come from different tables.
      margin: new Decimal(revenue).minus(cogs).toFixed(2),
    };
  });
}

/**
 * Stock sitting there that nothing has sold.
 *
 * The other half of "what should I order": this is what not to. Expiry catches
 * stock about to spoil, but a shelf of tinned goods nobody buys never expires
 * and never appears anywhere — it just quietly holds cash. Ordered by what it
 * is worth, because that is the decision.
 */
export async function deadStock(orgId: string, window: Window, limit = 8) {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        productId: products.id,
        label: products.name,
        quantity: sql<string>`${productStock.quantity}::text`,
        unit: products.unit,
        value: sql<string>`round(${productStock.quantity} * coalesce(${products.costPrice}, 0), 2)::text`,
      })
      .from(productStock)
      .innerJoin(products, eq(products.id, productStock.productId))
      .where(
        and(
          gt(productStock.quantity, '0'),
          eq(products.isActive, true),
          // Nothing sold in the window. `not exists` rather than a left join:
          // one row per product either way, and no risk of a fan-out inflating
          // the value column.
          // ISO strings with an explicit cast: a Date passed into a raw fragment
          // has no column to infer its type from, and the driver refuses it.
          sql`not exists (
            select 1 from ${saleLines}
            join ${sales} on ${sales.id} = ${saleLines.saleId}
            where ${saleLines.productId} = ${products.id}
              and ${sales.status} = 'completed'
              and ${sales.createdAt} >= ${window.from.toISOString()}::timestamptz
              and ${sales.createdAt} < ${window.to.toISOString()}::timestamptz
          )`,
        ),
      )
      .orderBy(desc(sql`${productStock.quantity} * coalesce(${products.costPrice}, 0)`))
      .limit(limit),
  );
}

