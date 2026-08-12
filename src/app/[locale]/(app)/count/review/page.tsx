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
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import { completeCountSession, getOpenSession, getVarianceReport } from '@/server/counting/sessions';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function CountReviewPage({ params }: PageProps<'/[locale]/count/review'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('count');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const session = await getOpenSession(orgId);
  // Rendered, not redirected. This URL is bookmarkable and survives a refresh,
  // and a redirect issued after the shell has streamed leaves a blank screen
  // until the client follows it.
  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-start gap-4 p-4">
        <BackLink href={`/${locale}/count`} label={tBack('count')} />
        <h1 className="text-xl font-semibold">{t('reviewTitle')}</h1>
        <p className="text-muted-foreground text-sm">{t('noSession')}</p>
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
    const open = await getOpenSession(orgId);
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
          {/* Net value first — it is the number the owner acts on. */}
          <HeadlineFigure
            label={t('netImpact')}
            value={money(summary.netValue)}
            caption={
              <span className="tabular-nums">
                {t('varianceCount', { count: summary.linesWithVariance })}
              </span>
            }
          />

          <DataList>
            {variances.map((v) => {
              const short = v.delta.startsWith('-');
              return (
                <DataRow
                  key={`${v.productId}-${v.batchId ?? 'none'}`}
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
