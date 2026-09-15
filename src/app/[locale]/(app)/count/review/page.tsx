import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';

import { CheckCircle2 } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { DataList, PageTitle, StatTile } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import { completeCountSession, getOpenSession, getVarianceReport } from '@/server/counting/sessions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the "Review Count Variances" frame: summary figures, one row per
 * difference with its quantity and money, then post or go back.
 *
 * Departures: the frame totals "56 units" and "-3 units" across products, and a
 * sum of kilos, litres and each is not a number, so the tiles count lines
 * instead. The frame's summary is a black panel with red figures on it, which
 * fails contrast; the tiles are the same StatTile Today uses. Its Post button is
 * blue; buttons here are ink.
 */
export default async function CountReviewPage({
  params,
  searchParams,
}: PageProps<'/[locale]/count/review'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('count');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { session: sessionParam } = await searchParams;
  const { orgId, userId } = await requireOrg(locale);

  // The count being finished is named in the URL, so this page is bookmarkable
  // and so finishing someone else's count reviews theirs, not yours.
  const sessionId = typeof sessionParam === 'string' ? sessionParam : undefined;
  const session = await getOpenSession(orgId, userId, sessionId);
  // Rendered, not redirected. This URL is bookmarkable and survives a refresh,
  // and a redirect issued after the shell has streamed leaves a blank screen
  // until the client follows it.
  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-start gap-4 p-4">
        <BackLink href={`/${locale}/count`} label={tBack('count')} />
        <PageTitle caption={t('noSession')}>{t('reviewTitle')}</PageTitle>
        <Link href={`/${locale}/count`} className={buttonVariants({ className: 'h-12' })}>
          {t('start')}
        </Link>
      </main>
    );
  }

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const { summary, variances, linesCounted } = await getVarianceReport(orgId, session.id);
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const shrinkLeads = summary.linesShort > 0;

  async function complete() {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    // Re-resolved by id inside the action: posting adjustments must close the
    // count that was on screen, never whichever one happens to be newest.
    const open = await getOpenSession(orgId, userId, sessionId);
    if (open) {
      await completeCountSession(orgId, open.id, userId);
      // A completed count is exactly what makes a new rate computable, so
      // refresh here rather than leaving rates stale until someone asks.
      await recalculateConsumptionRates(orgId);
    }
    redirect(`/${locale}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:max-w-3xl">
      <BackLink href={`/${locale}/count`} label={tBack('count')} />
      <PageTitle caption={t('reviewIntro')}>{t('reviewTitle')}</PageTitle>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label={t('linesCountedLabel')}>{linesCounted}</StatTile>
        <StatTile label={t('linesDifferLabel')}>{summary.linesWithVariance}</StatTile>
        {/* Shrinkage first when there is any: the gap between what real sales
            say should be on the shelf and what's actually there is the reason
            counting still exists once POS supplies consumption. */}
        <StatTile
          label={shrinkLeads ? t('shrinkValue') : t('gainValue')}
          className={shrinkLeads ? 'text-destructive' : ''}
        >
          {shrinkLeads ? `−${money(summary.shrinkValue)}` : money(summary.gainValue)}
        </StatTile>
      </div>
      {variances.length > 0 && (
        <p className="text-muted-foreground -mt-3 text-sm">
          {shrinkLeads ? t('shrinkHint') : t('gainHint')}
          {summary.linesShort > 0 && summary.linesOver > 0 && (
            <span className="tabular-nums"> {t('netImpact')}: {money(summary.netValue)}</span>
          )}
        </p>
      )}

      {variances.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('noVariance')} />
      ) : (
        <DataList>
          {variances.map((v) => {
            const short = v.delta.startsWith('-');
            const value = v.unitCost ? new Decimal(v.delta).times(v.unitCost) : null;
            return (
              <li key={`${v.productId}-${v.batchId ?? 'none'}`}>
                <Link
                  href={`/${locale}/products/${v.productId}`}
                  className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-base font-medium">{v.productName}</span>
                    <span className="text-muted-foreground truncate text-sm">
                      {t('expectedVsCounted', {
                        expected: trimQuantity(v.expected),
                        counted: trimQuantity(v.counted),
                      })}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {/* Direction in words and sign as well as colour, so it
                        survives a glance and a colourblind reader. */}
                    <span
                      className={`rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${
                        short ? 'bg-destructive-subtle text-destructive' : 'bg-muted'
                      }`}
                    >
                      <span className="sr-only">{short ? t('short') : t('over')} </span>
                      {short ? '' : '+'}
                      {trimQuantity(v.delta)}
                    </span>
                    {value && (
                      <span
                        className={`text-xs font-semibold tabular-nums ${short ? 'text-destructive' : 'text-muted-foreground'}`}
                      >
                        {short ? '' : '+'}
                        {money(value.toFixed(2))}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </DataList>
      )}

      {/* In flow, not pinned: the frame puts both actions under the list, and
          posting is the one write on this screen — it should be reached after
          reading the rows, not float over them. */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={complete} className="sm:order-2">
          {/* This is the write. Everything before it was reversible. */}
          <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
            {t('postAdjustments', { count: summary.linesWithVariance })}
          </Button>
        </form>
        <Link
          href={`/${locale}/count`}
          className={buttonVariants({ variant: 'outline', className: 'bg-card h-12 w-full sm:w-fit sm:px-8' })}
        >
          {t('keepCounting')}
        </Link>
      </div>
    </main>
  );
}
