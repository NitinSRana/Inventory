import { getFormatter, getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowUp } from 'lucide-react';

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
      <div className="flex flex-wrap gap-6">
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

      {trend && (
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

      {mix.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <SectionHeading>{t('categoryMix')}</SectionHeading>
          <RankedBars items={mix} format={(v) => `${v}%`} emptyLabel={t('noStock')} />
        </section>
      )}
    </section>
  );
}
