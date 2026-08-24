import { and, eq, gte, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';

import { categories, products } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { countProducts } from '@/server/catalog/import';
import { marginPercent } from '@/server/settings/valuation';
import { getRatesByBand } from '@/server/settings/vat';

/**
 * The homepage's general inventory-health section — value, margin, category
 * mix — as opposed to trends.ts, which answers Insights' own questions
 * (takings, margin from actual sales, top products).
 *
 * No price-history table exists: products.sell_price/cost_price are current
 * values only, nothing records what they were last month. That is why a
 * value *trend* is buildable here (stock_movements is the append-only ledger,
 * so "what was on hand 30 days ago" is a real fact) but a margin *trend* is
 * not (margin needs a historical price, which was never captured) — shown as
 * a point-in-time figure only, never a fabricated delta.
 */

/**
 * On-hand quantity as of a point in time (the ledger sum up to that instant),
 * valued at **today's** sell price — a retail/gross valuation, the same
 * question topProductsByRevenue's sibling topProductsByStockValue answers per
 * product, just summed. Deliberately not the stock-on-hand report's
 * cost-based valuation (that one answers "what did I pay for this" and stays
 * exactly as docs/uk-vat-changes.md left it) — a different question, not a
 * competing answer to the same one.
 */
async function stockValueAsOf(orgId: string, asOf: Date): Promise<Decimal> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx.execute<{ value: string }>(sql`
      select coalesce(round(sum(bal.qty * coalesce(p.sell_price, 0)), 2), 0)::text as value
      from (
        select product_id, sum(quantity_delta) as qty
        from stock_movements
        where organization_id = ${orgId} and occurred_at <= ${asOf.toISOString()}
        group by product_id
      ) bal
      join products p on p.id = bal.product_id
      where p.organization_id = ${orgId} and p.is_active = true and bal.qty > 0
    `);
    return new Decimal(rows[0]?.value ?? '0');
  });
}

export type InventoryValueSummary = { current: string; changePercent: string | null };

/** Current inventory value, and how it has moved against 30 days ago. */
export async function inventoryValueSummary(orgId: string): Promise<InventoryValueSummary> {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [current, past] = await Promise.all([
    stockValueAsOf(orgId, now),
    stockValueAsOf(orgId, monthAgo),
  ]);

  return {
    current: current.toFixed(2),
    // Nothing to compare against yet (a brand new shop) reads as "no prior
    // period," never as a misleading 0%.
    changePercent: past.greaterThan(0)
      ? current.minus(past).dividedBy(past).times(100).toFixed(1)
      : null,
  };
}

export type ValuePoint = { day: string; value: string };

/** Six month-end points, oldest first — the same shape TrendBars already expects. */
export async function inventoryValueTrend(orgId: string): Promise<ValuePoint[]> {
  const now = new Date();
  const checkpoints = Array.from({ length: 6 }, (_, i) => {
    // Last day of (this month - (5 - i) months): the 0th of next month is the
    // last day of this one, which sidesteps every "which months have 31 days"
    // question.
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0);
    return d;
  });

  const values = await Promise.all(checkpoints.map((d) => stockValueAsOf(orgId, d)));
  return checkpoints.map((d, i) => ({
    day: d.toLocaleDateString('en', { month: 'short' }),
    value: values[i].toFixed(2),
  }));
}

export type MarginSummary = { percent: string | null; sampleSize: number };

/**
 * Average margin across every active, fully-priced product, right now.
 * No trend: see the module comment for why one isn't shown.
 */
export async function averageMargin(orgId: string): Promise<MarginSummary> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({
        sellPrice: products.sellPrice,
        costPrice: products.costPrice,
        vatBand: products.vatBand,
      })
      .from(products)
      .where(and(eq(products.isActive, true), sql`${products.sellPrice} is not null`, sql`${products.costPrice} is not null`));

    if (rows.length === 0) return { percent: null, sampleSize: 0 };

    const rates = await getRatesByBand(orgId);
    const margins = rows
      .map((r) => marginPercent(r.sellPrice!, r.costPrice!, rates[r.vatBand as keyof typeof rates] ?? '0'))
      .filter((m): m is string => m !== null)
      .map((m) => new Decimal(m));

    if (margins.length === 0) return { percent: null, sampleSize: 0 };

    const avg = margins.reduce((sum, m) => sum.plus(m), new Decimal(0)).dividedBy(margins.length);
    return { percent: avg.toFixed(1), sampleSize: margins.length };
  });
}

export type CategoryMixRow = { label: string; value: string };

/** On-hand units by category, as a percentage of the total — for RankedBars. */
export async function categoryMix(orgId: string, uncategorizedLabel: string): Promise<CategoryMixRow[]> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx.execute<{ label: string | null; qty: string }>(sql`
      select c.name as label, sum(sl.quantity) as qty
      from stock_levels sl
      join products p on p.id = sl.product_id
      left join categories c on c.id = p.category_id
      where sl.organization_id = ${orgId} and p.is_active = true and sl.quantity > 0
      group by c.name
    `);

    const total = rows.reduce((sum, r) => sum.plus(r.qty), new Decimal(0));
    if (total.lessThanOrEqualTo(0)) return [];

    return rows
      .map((r) => ({
        label: r.label ?? uncategorizedLabel,
        value: new Decimal(r.qty).dividedBy(total).times(100).toFixed(1),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value));
  });
}

export type ProductSummary = { total: number; categories: number; addedThisMonth: number };

/** Product and category counts, plus how many products are new this month. */
export async function productSummary(orgId: string): Promise<ProductSummary> {
  return withTenant(orgId, async (tx) => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [total, [categoryRow], [addedRow]] = await Promise.all([
      countProducts(orgId),
      tx.select({ n: sql<number>`count(*)::int` }).from(categories),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.isActive, true), gte(products.createdAt, startOfMonth))),
    ]);

    return { total, categories: categoryRow?.n ?? 0, addedThisMonth: addedRow?.n ?? 0 };
  });
}
