import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button, buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
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
  const format = await getFormatter();
  const { orgId } = await requireOrg(locale);

  const session = await getOpenSession(orgId);
  if (!session) redirect(`/${locale}/count`);

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
      <h1 className="text-2xl font-semibold">{t('reviewTitle')}</h1>

      {variances.length === 0 ? (
        <p className="text-sm">{t('noVariance')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {/* Net value first — it is the number the owner acts on. */}
            <p className="text-3xl font-semibold tabular-nums">
              {money(summary.netValue)}{' '}
              <span className="text-muted-foreground text-base font-normal">{t('netImpact')}</span>
            </p>
            <p className="text-muted-foreground text-sm tabular-nums">
              {t('varianceCount', { count: summary.linesWithVariance })}
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {variances.map((v) => {
              const short = v.delta.startsWith('-');
              return (
                <li key={`${v.productId}-${v.batchId ?? 'none'}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{v.productName}</span>
                    {/* Sign is stated in words as well as by the number, so the
                        direction survives a glance and a colourblind reader. */}
                    <span className="text-muted-foreground text-xs">
                      {short ? t('short') : t('over')} · {t('expectedVsCounted', { expected: v.expected, counted: v.counted })}
                    </span>
                  </div>
                  <span className={`shrink-0 text-sm font-medium tabular-nums ${short ? 'text-destructive' : 'text-foreground'}`}>
                    {short ? '' : '+'}
                    {v.delta}
                  </span>
                </li>
              );
            })}
          </ul>
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
          <Button type="submit" className="fixed inset-x-4 bottom-6 h-12 sm:static sm:w-fit">
            {t('postAdjustments', { count: summary.linesWithVariance })}
          </Button>
        </form>
      </div>
    </main>
  );
}
