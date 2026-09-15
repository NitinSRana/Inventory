import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CircleCheck } from 'lucide-react';

import { DataGroupHeader, DataList, DataRow, SectionHeading, StatTile } from '@/components/data-list';
import { UrgencyBadge, urgencyClass, urgencyOf } from '@/components/expiry-urgency';
import { FirstRun } from '@/components/first-run';
import { trimQuantity } from '@/lib/quantity';
import { roleAtLeast } from '@/server/auth/roles';
import { countProducts } from '@/server/catalog/import';
import { getExpiringStock, getExpiryExposure, getProductStock } from '@/server/stock/levels';
import { getMitigatedLosses } from '@/server/stock/markdowns';

/**
 * The expiry dashboard — the homepage, and the screen that sells the product.
 * It has to land in one glance and be readable at arm's length.
 *
 * Laid out after the Figma "Today" frame (23:10): a row of figure tiles, then
 * the list. One deliberate difference: the frame paints the at-risk value red.
 * It stays in the foreground colour here — it is a fact, not an alarm
 * (CLAUDE.md, design system). Only the counts that are a state of the world,
 * expired and next 3 days, take an urgency colour, and only when non-zero.
 *
 * Grouped worst-first rather than merely sorted: a sorted list makes the reader
 * find the boundary between "act now" and "watch this" themselves; sticky
 * headers state it.
 */
export async function ExpiryDashboard({
  orgId,
  locale,
  currency,
  role,
}: {
  orgId: string;
  locale: string;
  currency: string;
  role: string;
}) {
  const t = await getTranslations('dashboard');
  const format = await getFormatter();
  // Recovered money comes from sales totals, which are manager+ everywhere else.
  const canManage = roleAtLeast(role, 'manager');

  const [rows, exposure, mitigated] = await Promise.all([
    getExpiringStock(orgId, 14),
    getExpiryExposure(orgId, 14),
    canManage ? getMitigatedLosses(orgId) : null,
  ]);

  // Display only — no arithmetic is done on these, so no float risk.
  const money = (v: string | null) =>
    format.number(Number(v ?? 0), { style: 'currency', currency });

  if (rows.length === 0) {
    // "Nothing expiring" means one of two very different things: a shop with no
    // data yet, or a shop on top of things. Telling them apart is the difference
    // between guidance and a dead end.
    const [productCount, stock] = await Promise.all([countProducts(orgId), getProductStock(orgId)]);
    if (productCount === 0 || stock.length === 0) {
      return <FirstRun locale={locale} hasProducts={productCount > 0} hasStock={stock.length > 0} />;
    }
  }

  // The same three buckets the tiles count and the list groups by — one idea
  // stated twice rather than two competing ones.
  const buckets = [
    { key: 'expired', rows: rows.filter((r) => (r.daysRemaining ?? 0) < 0) },
    { key: 'critical', rows: rows.filter((r) => (r.daysRemaining ?? 0) >= 0 && (r.daysRemaining ?? 0) <= 3) },
    { key: 'soon', rows: rows.filter((r) => (r.daysRemaining ?? 0) > 3) },
  ] as const;
  const [expired, critical] = buckets;

  const count = (n: number, tone: string) => ({
    // Zero expired is good news, not a red figure.
    className: n > 0 ? tone : '',
    children: (
      <>
        {n}{' '}
        <span className="text-muted-foreground text-xs font-semibold">{t('batchesUnit', { count: n })}</span>
      </>
    ),
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SectionHeading>{t('metricsTitle')}</SectionHeading>
        <div className={`grid grid-cols-3 gap-2 ${mitigated !== null ? 'md:grid-cols-4' : ''}`}>
          <StatTile label={t('atRiskTile')}>{money(exposure.valueAtRisk)}</StatTile>
          {/* Jump links rather than filters — no client JS, and the counts stay
              visible while you read the list. */}
          <StatTile label={t('buckets.critical')} href="#critical" {...count(critical.rows.length, 'text-warning')} />
          <StatTile label={t('buckets.expired')} href="#expired" {...count(expired.rows.length, 'text-destructive')} />
          {mitigated !== null && (
            <StatTile
              label={t('mitigated')}
              caption={t('mitigatedCaption')}
              tileClassName="col-span-3 md:col-span-1"
            >
              {money(mitigated)}
            </StatTile>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          {rows.length > 0 && (
            <Link
              href={`/${locale}/reports/expiry`}
              className="text-link inline-flex min-h-11 items-center text-sm font-semibold"
            >
              {t('viewAll')}
            </Link>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="bg-card flex flex-col items-center gap-2 rounded-xl border p-4 text-center">
            <CircleCheck aria-hidden className="text-success size-6" />
            <p className="text-sm font-semibold">{t('emptyTitle')}</p>
            <p className="text-muted-foreground max-w-[30ch] text-sm">{t('nothingExpiring')}</p>
          </div>
        ) : (
          <DataList>
            {/* Each header immediately followed by its own rows, so the sticky
                header is always the one describing what is on screen. */}
            {buckets.flatMap((bucket) =>
              bucket.rows.length === 0
                ? []
                : [
                    <DataGroupHeader key={`${bucket.key}-header`}>
                      {/* The anchor sits on the header so the tile lands here. */}
                      <span id={bucket.key}>{t(`groups.${bucket.key}`)}</span>
                    </DataGroupHeader>,
                    ...bucket.rows.map((r) => {
                      const urgency = urgencyOf(r.daysRemaining);
                      return (
                        <DataRow
                          key={r.batchId}
                          // The whole point of this screen is to prompt an action,
                          // and the action is nearly always about the product.
                          href={`/${locale}/products/${r.productId}`}
                          tall
                          title={r.productName}
                          subtitle={
                            <UrgencyBadge
                              urgency={urgency}
                              label={
                                r.daysRemaining !== null && r.daysRemaining < 0
                                  ? // Legally distinct: use-by past date cannot be
                                    // sold at all, best-before is a markdown
                                    // prompt. Same urgency tier, different words.
                                    t(r.dateType === 'use_by' ? 'expiredUseBy' : 'expiredBestBefore', {
                                      days: Math.abs(r.daysRemaining),
                                    })
                                  : t('daysLeft', { days: r.daysRemaining ?? 0 })
                              }
                            />
                          }
                          value={money(r.valueAtRisk)}
                          valueClassName={urgencyClass(urgency)}
                          meta={
                            <>
                              {trimQuantity(r.quantity ?? '0')} <span className="opacity-70">{t('units')}</span>
                            </>
                          }
                        />
                      );
                    }),
                  ],
            )}
          </DataList>
        )}
      </section>
    </div>
  );
}
