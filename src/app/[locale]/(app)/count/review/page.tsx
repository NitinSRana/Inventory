import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CheckCircle2 } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { DataList, DataRow, HeadlineFigure, PageTitle } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { roleAtLeast } from '@/server/auth/roles';
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import { completeCountSession, getOpenSession, getVarianceReport } from '@/server/counting/sessions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

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
  const { orgId, userId, role } = await requireOrg(locale);
  // Counting is staff work but product detail is manager-gated, so the
  // link is only offered to someone who can actually follow it.
  const canOpenProduct = roleAtLeast(role, 'manager');

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
  const { summary, variances } = await getVarianceReport(orgId, session.id);
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });

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
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/count`} label={tBack('count')} />
      <PageTitle>{t('reviewTitle')}</PageTitle>

      {variances.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('noVariance')} />
      ) : (
        <>
          {/* Shrinkage first when there is any: the gap between what real sales
              say should be on the shelf and what's actually there is the reason
              counting still exists once POS supplies consumption. Found stock
              leads only when nothing is missing. */}
          <HeadlineFigure
            label={summary.linesShort > 0 ? t('shrinkValue') : t('gainValue')}
            value={money(summary.linesShort > 0 ? summary.shrinkValue : summary.gainValue)}
            className={summary.linesShort > 0 ? 'text-destructive' : undefined}
            caption={
              <span className="flex flex-col gap-1">
                <span className="tabular-nums">
                  {t('varianceCount', { count: summary.linesWithVariance })}
                </span>
                <span>{summary.linesShort > 0 ? t('shrinkHint') : t('gainHint')}</span>
              </span>
            }
          />
          {summary.linesShort > 0 && summary.linesOver > 0 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {t('netImpact')}: {money(summary.netValue)}
            </p>
          )}

          <DataList>
            {variances.map((v) => {
              const short = v.delta.startsWith('-');
              return (
                <DataRow
                  key={`${v.productId}-${v.batchId ?? 'none'}`}
                  href={canOpenProduct ? `/${locale}/products/${v.productId}` : undefined}
                  title={v.productName}
                  // Sign is stated in words as well as by the number, so the
                  // direction survives a glance and a colourblind reader.
                  subtitle={`${short ? t('short') : t('over')} · ${t('expectedVsCounted', {
                    expected: trimQuantity(v.expected),
                    counted: trimQuantity(v.counted),
                  })}`}
                  value={`${short ? '' : '+'}${trimQuantity(v.delta)}`}
                  valueClassName={`tabular-nums ${short ? 'text-destructive' : ''}`}
                />
              );
            })}
          </DataList>
        </>
      )}

      <div className="flex flex-col gap-3">
        <Link
          href={`/${locale}/count`}
          className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
        >
          {t('keepCounting')}
        </Link>
        <form action={complete}>
          {/* This is the write. Everything before it was reversible. */}
          <StickyAction>
            <Button type="submit" className="h-12 w-full sm:w-fit">
              {t('postAdjustments', { count: summary.linesWithVariance })}
            </Button>
          </StickyAction>
        </form>
      </div>
    </main>
  );
}
