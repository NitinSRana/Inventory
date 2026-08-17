import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import Decimal from 'decimal.js';

import { BackLink } from '@/components/back-link';
import { RankedBars, TrendBars } from '@/components/charts';
import { PageTitle, SectionHeading } from '@/components/data-list';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import {
  dailyRevenue,
  dailyWaste,
  topProductsByRevenue,
  wasteByReason,
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
  const tReasons = await getTranslations('products.reasonCodes');
  const format = await getFormatter();
  const { orgId } = await requireRole(locale, 'manager');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const [revenue, waste, topProducts, losses] = await Promise.all([
    dailyRevenue(orgId, period),
    dailyWaste(orgId, period),
    topProductsByRevenue(orgId, period, 5),
    wasteByReason(orgId, period),
  ]);

  const money = (v: string) =>
    format.number(Number(v), { style: 'currency', currency: org.currencyCode });

  const sum = (points: { value: string }[]) =>
    points.reduce((acc, p) => acc.plus(p.value), new Decimal(0)).toFixed(2);

  const revenueTotal = sum(revenue);
  const wasteTotal = sum(waste);
  // What the losses cost as a share of what came in — the one derived figure
  // here, and the one a shopkeeper reads first.
  const wasteShare = new Decimal(revenueTotal).greaterThan(0)
    ? new Decimal(wasteTotal).dividedBy(revenueTotal).times(100).toDecimalPlaces(1).toString()
    : null;

  const nothingYet = new Decimal(revenueTotal).equals(0) && new Decimal(wasteTotal).equals(0);

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
          <div className="grid gap-6 md:grid-cols-2">
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <SectionHeading>{t('takings')}</SectionHeading>
              <p className="text-3xl font-semibold tabular-nums">{money(revenueTotal)}</p>
              <TrendBars points={revenue} format={money} label={t('takingsChart', { days: period })} />
            </section>

            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <SectionHeading>{t('losses')}</SectionHeading>
              <p className="text-3xl font-semibold tabular-nums">{money(wasteTotal)}</p>
              {/* Stated against takings, because £40 of waste means nothing
                  until you know whether the shop took £400 or £4,000. */}
              <p className="text-muted-foreground text-sm">
                {wasteShare === null ? t('lossesNoSales') : t('lossesShare', { percent: wasteShare })}
              </p>
              <TrendBars points={waste} format={money} label={t('lossesChart', { days: period })} />
            </section>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <SectionHeading>{t('topProducts')}</SectionHeading>
              <RankedBars items={topProducts} format={money} emptyLabel={t('noSales')} />
            </section>

            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <SectionHeading>{t('lossesByReason')}</SectionHeading>
              <RankedBars
                items={losses.map((l) => ({ ...l, label: tReasons(l.label) }))}
                format={money}
                emptyLabel={t('noWaste')}
              />
            </section>
          </div>
        </>
      )}
    </main>
  );
}
