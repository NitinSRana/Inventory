import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { products, saleLines, sales, stockMovements } from '@/db/schema';
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

/** What was binned per day, as a positive figure — the ledger stores it negative. */
export async function dailyWaste(orgId: string, days = 30): Promise<DayPoint[]> {
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
        coalesce(
          round(abs(sum(${stockMovements.quantityDelta} * coalesce(${products.costPrice}, 0))), 2),
          0
        )::text as value
      from spine
      left join ${stockMovements}
        on ${stockMovements.occurredAt}::date = spine.day
       and ${stockMovements.movementType} = 'waste'
      left join ${products} on ${products.id} = ${stockMovements.productId}
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

/** Where the losses come from, biggest first. Values are positive. */
export async function wasteByReason(orgId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  return withTenant(orgId, (tx) =>
    tx
      .select({
        label: sql<string>`coalesce(${stockMovements.reasonCode}, 'other')`,
        value: sql<string>`round(abs(sum(${stockMovements.quantityDelta} * coalesce(${products.costPrice}, 0))), 2)::text`,
      })
      .from(stockMovements)
      .leftJoin(products, eq(products.id, stockMovements.productId))
      .where(and(eq(stockMovements.movementType, 'waste'), gte(stockMovements.occurredAt, since)))
      .groupBy(stockMovements.reasonCode)
      .orderBy(desc(sql`abs(sum(${stockMovements.quantityDelta} * coalesce(${products.costPrice}, 0)))`)),
  );
}
