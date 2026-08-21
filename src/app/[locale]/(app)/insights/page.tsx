import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { RankedBars, TrendBars } from '@/components/charts';
import { DataList, DataRow, PageTitle, SectionHeading } from '@/components/data-list';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireRole } from '@/server/auth/session';
import {
  dailyRevenue,
  deadStock,
  grossMargin,
  topProductsByRevenue,
  topProductsByStockValue,
  windowFor,
} from '@/server/analytics/trends';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

const PERIODS = [7, 30, 90] as const;

/**
 * The shape of the last few weeks.
 *
 * The reports answer "what exactly"; this answers "how is it going", which is a
 * different question and a worse fit for a table. Manager and above: it is the
 * takings and the losses on one screen.
 */
export default async function InsightsPage({ params, searchParams }: PageProps<'/[locale]/insights'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { days } = await searchParams;
  const period = PERIODS.includes(Number(days) as (typeof PERIODS)[number]) ? Number(days) : 30;

  const t = await getTranslations('insights');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const now = windowFor(period);
  const previous = windowFor(period, 1);
  const [revenue, topProducts, topByStock, margin, priorMargin, stuck] = await Promise.all([
    dailyRevenue(orgId, period),
    topProductsByRevenue(orgId, period, 5),
    topProductsByStockValue(orgId, 5),
    grossMargin(orgId, now),
    grossMargin(orgId, previous),
    deadStock(orgId, now, 8),
  ]);

  const money = (v: string) =>
    format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  const sum = (points: { value: string }[]) =>
    points.reduce((acc, p) => acc.plus(p.value), new Decimal(0)).toFixed(2);

  const revenueTotal = sum(revenue);
  const nothingYet = new Decimal(revenueTotal).equals(0);

  /**
   * Change against the period before. A figure alone says almost nothing: six
   * thousand in takings is either a good month or a collapse, and the month
   * before is the cheapest way to tell.
   *
   * Null when there is nothing to compare against — a shop's first month has no
   * previous month, and "+100%" would be a fiction.
   */
  const changeVsPrevious = (current: string, prior: string) => {
    const before = new Decimal(prior);
    if (before.lessThanOrEqualTo(0)) return null;
    return new Decimal(current).minus(before).dividedBy(before).times(100).toDecimalPlaces(1).toString();
  };

  const marginChange = changeVsPrevious(margin.margin, priorMargin.margin);
  const takingsChange = changeVsPrevious(margin.revenue, priorMargin.revenue);
  // Margin as a share of takings — the number that says whether volume is
  // actually worth having.
  const marginPercent = new Decimal(margin.revenue).greaterThan(0)
    ? new Decimal(margin.margin).dividedBy(margin.revenue).times(100).toDecimalPlaces(1).toString()
    : null;

  /**
   * `higherIsBetter` stays a parameter rather than being assumed: not every
   * figure this could ever be attached to is one where up is good news.
   *
   * A function returning elements rather than a component declared in render —
   * it holds no state, so nesting a component here would only give React
   * something to needlessly remount.
   */
  const delta = (percent: string | null, higherIsBetter: boolean) => {
    if (percent === null) return <span className="text-muted-foreground text-sm">{t('noPrior')}</span>;
    const up = !percent.startsWith('-');
    const good = up === higherIsBetter;
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-sm tabular-nums">
        {/* The arrow says direction, the word says whether that is good news.
            Neither is carried by colour: this palette is spent on expiry. */}
        {up ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />}
        {t('vsPrevious', { percent: percent.replace('-', ''), days: period })}
        <span className={good ? 'font-medium' : 'text-destructive font-medium'}>
          {good ? t('better') : t('worse')}
        </span>
      </span>
    );
  };

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      <nav aria-label={t('periodLabel')} className="flex gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/${locale}/insights?days=${p}`}
            aria-current={p === period ? 'page' : undefined}
            className={buttonVariants({
              variant: p === period ? 'default' : 'outline',
              className: 'h-11',
            })}
          >
            {t('lastDays', { days: p })}
          </Link>
        ))}
      </nav>

      {/* A shop that has not traded yet gets told so, rather than being shown
          four empty charts and left to wonder which part is broken. */}
      {nothingYet ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
          <h2 className="text-lg font-medium">{t('emptyTitle')}</h2>
          <p className="text-muted-foreground max-w-[52ch] text-sm">{t('emptyBody')}</p>
          <Link href={`/${locale}/checkout`} className={buttonVariants({ className: 'h-11' })}>
            {t('goToCheckout')}
          </Link>
        </div>
      ) : (
        <>
          {/* Margin first, above takings. Selling more at a worse price shows up
              as a rising takings figure and a falling margin, and only one of
              those is the business getting better. */}
          <section className="flex flex-col gap-2 rounded-lg border p-4">
            <SectionHeading>{t('margin')}</SectionHeading>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-4xl font-semibold tabular-nums md:text-5xl">
                {money(margin.margin)}
              </p>
              {marginPercent !== null && (
                <p className="text-muted-foreground text-lg tabular-nums">
                  {t('marginPercent', { percent: marginPercent })}
                </p>
              )}
            </div>
            {delta(marginChange, true)}
            <p className="text-muted-foreground text-sm tabular-nums">
              {t('marginWorking', { revenue: money(margin.revenue), cogs: money(margin.cogs) })}
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border p-4">
            <SectionHeading>{t('takings')}</SectionHeading>
            <p className="text-3xl font-semibold tabular-nums">{money(revenueTotal)}</p>
            {delta(takingsChange, true)}
            <TrendBars points={revenue} format={money} label={t('takingsChart', { days: period })} />
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <SectionHeading>{t('topProducts')}</SectionHeading>
              <RankedBars items={topProducts} format={money} emptyLabel={t('noSales')} />
            </section>

            {/* What sold vs. what's sitting there worth the most — two
                different questions a top-5-by-revenue list alone can't answer. */}
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <SectionHeading>{t('topByStockValue')}</SectionHeading>
              <RankedBars items={topByStock} format={money} emptyLabel={t('noStock')} />
            </section>
          </div>

          {/* The other half of "what should I order": what not to. Expiry
              catches stock about to spoil; this catches stock that will
              never spoil and will never sell either. */}
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <SectionHeading>{t('deadStock')}</SectionHeading>
            <p className="text-muted-foreground text-sm">{t('deadStockHint', { days: period })}</p>
            {stuck.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noDeadStock')}</p>
            ) : (
              <DataList>
                {stuck.map((p) => (
                  <DataRow
                    key={p.productId}
                    href={`/${locale}/products/${p.productId}`}
                    title={p.label}
                    subtitle={
                      <>
                        {trimQuantity(p.quantity)} <span className="opacity-70">{p.unit}</span>
                      </>
                    }
                    value={money(p.value)}
                  />
                ))}
              </DataList>
            )}
          </section>
        </>
      )}
    </main>
  );
}
