import { getFormatter, getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Decimal from 'decimal.js';

import { RankedBars, TrendBars } from '@/components/charts';
import { SectionHeading } from '@/components/data-list';
import { roleAtLeast } from '@/server/auth/roles';
import {
  averageMargin,
  categoryMix,
  inventoryValueSummary,
  inventoryValueTrend,
  productSummary,
} from '@/server/analytics/overview';

/**
 * General inventory health — value, margin, category mix — above the
 * expiry-risk section that used to be this whole page. Value and margin are
 * manager+ only, same as everywhere else in the app cost/margin figures
 * appear (the product page, Insights); product count and category mix carry
 * no money and stay staff-readable, matching Products' own gating.
 *
 * No reorder/low-stock tile here — see CLAUDE.md's "Removed, not merely
 * never built" section for why that stays out regardless of what any
 * reference design shows.
 */
export async function InventoryOverview({
  orgId,
  currency,
  role,
}: {
  orgId: string;
  locale: string;
  currency: string;
  role: string;
}) {
  const t = await getTranslations('overview');
  const format = await getFormatter();
  const canManage = roleAtLeast(role, 'manager');

  const [summary, trend, margin, mix, products] = await Promise.all([
    canManage ? inventoryValueSummary(orgId) : null,
    canManage ? inventoryValueTrend(orgId) : null,
    canManage ? averageMargin(orgId) : null,
    categoryMix(orgId, t('uncategorized')),
    productSummary(orgId),
  ]);

  const money = (v: string) => format.number(Number(v), { style: 'currency', currency });

  // Decimal rather than Number: these are numeric strings off the ledger, and
  // the project's rule against float arithmetic on money holds even when the
  // result only decides whether a chart renders.
  const monthsWithStock = trend?.filter((p) => new Decimal(p.value).greaterThan(0)).length ?? 0;

  const delta = (percent: string | null) => {
    if (percent === null) return null;
    const up = !percent.startsWith('-');
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs tabular-nums">
        {up ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />}
        {t('vsLastMonth', { percent: percent.replace('-', '') })}
      </span>
    );
  };

  return (
    <section className="flex flex-col gap-6">
      {/* A grid rather than flex-wrap: content-sized tiles left-aligned leave
          the right half of a desktop row empty, and the figures sit at ragged
          intervals when one is much longer than the next. Three columns only
          when all three render — Inventory value and Avg margin are manager+,
          so a staff member sees Products alone, and one tile squeezed into a
          third of the row is worse than the full-width one it has today. */}
      <div className={`grid gap-6 ${canManage ? 'sm:grid-cols-3' : ''}`}>
        {summary && (
          <div className="flex flex-col gap-0.5">
            <SectionHeading>{t('inventoryValue')}</SectionHeading>
            <p className="font-mono text-3xl font-semibold tabular-nums">{money(summary.current)}</p>
            {delta(summary.changePercent) ?? (
              <span className="text-muted-foreground text-xs">{t('noPriorPeriod')}</span>
            )}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <SectionHeading>{t('products')}</SectionHeading>
          <p className="font-mono text-3xl font-semibold tabular-nums">{products.total}</p>
          <span className="text-muted-foreground text-xs">
            {t('productsMeta', { categories: products.categories, added: products.addedThisMonth })}
          </span>
        </div>

        {margin && (
          <div className="flex flex-col gap-0.5">
            <SectionHeading>{t('avgMargin')}</SectionHeading>
            <p className="font-mono text-3xl font-semibold tabular-nums">
              {margin.percent === null ? '—' : `${margin.percent}%`}
            </p>
            <span className="text-muted-foreground text-xs">
              {margin.percent === null
                ? t('marginUnavailable')
                : t('marginMeta', { count: margin.sampleSize })}
            </span>
          </div>
        )}
      </div>

      {/* Two points before this is a trend at all.
          The zero months are not "the stock was worth nothing" — they are
          months before this shop had any, and TrendBars is right to draw a
          zero as a real column (a closed Sunday in a revenue series is a
          fact worth seeing). Here it would be a lie: one bar against five
          empty ones reads as a collapse rather than as a new shop, and the
          caller is the only one that knows the difference. */}
      {trend && monthsWithStock >= 2 && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <SectionHeading>{t('valueTrend')}</SectionHeading>
          {/* No price-history table exists, so each point is *today's*
              quantity-then rather than a genuinely historical valuation —
              said plainly rather than left implied, since prices moving
              since then would otherwise misshape the trend silently. */}
          <p className="text-muted-foreground text-xs">{t('valueTrendHint')}</p>
          <TrendBars points={trend} format={money} label={t('valueTrendLabel')} />
        </section>
      )}

      {/* A mix of one is not a mix: a lone "Uncategorized 100.0%" bar is a
          full-width row carrying no information a reader did not already
          have from the product count above. */}
      {mix.length >= 2 && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <SectionHeading>{t('categoryMix')}</SectionHeading>
          <RankedBars items={mix} format={(v) => `${v}%`} emptyLabel={t('noStock')} />
        </section>
      )}
    </section>
  );
}
