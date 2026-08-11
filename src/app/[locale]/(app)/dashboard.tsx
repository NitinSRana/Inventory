import { getFormatter, getTranslations } from 'next-intl/server';

import { DataGroupHeader, DataList, DataRow, HeadlineFigure } from '@/components/data-list';
import { UrgencyBadge, urgencyClass, urgencyOf } from '@/components/expiry-urgency';
import { FirstRun } from '@/components/first-run';
import { trimQuantity } from '@/lib/quantity';
import { countProducts } from '@/server/catalog/import';
import { getExpiringStock, getExpiryExposure, getProductStock } from '@/server/stock/levels';

/**
 * The expiry dashboard — the homepage, and the screen that sells the product.
 * It has to land in one glance and be readable at arm's length.
 *
 * Grouped worst-first rather than merely sorted: a sorted list makes the reader
 * find the boundary between "act now" and "watch this" themselves; sticky
 * headers state it.
 */
export async function ExpiryDashboard({
  orgId,
  locale,
  currency,
}: {
  orgId: string;
  locale: string;
  currency: string;
}) {
  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  const [rows, exposure] = await Promise.all([
    getExpiringStock(orgId, 14),
    getExpiryExposure(orgId, 14),
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

    return (
      <section className="flex flex-col items-start gap-3 px-4 py-12">
        <h2 className="text-lg font-medium">{t('emptyTitle')}</h2>
        <p className="text-muted-foreground max-w-[30ch] text-sm">{t('nothingExpiring')}</p>
      </section>
    );
  }

  // The same three buckets the strip counts and the list groups by — one idea
  // stated twice rather than two competing ones.
  const buckets = [
    { key: 'expired', rows: rows.filter((r) => (r.daysRemaining ?? 0) < 0), tone: 'text-destructive' },
    {
      key: 'critical',
      rows: rows.filter((r) => (r.daysRemaining ?? 0) >= 0 && (r.daysRemaining ?? 0) <= 3),
      tone: 'text-warning',
    },
    {
      key: 'soon',
      rows: rows.filter((r) => (r.daysRemaining ?? 0) > 3),
      tone: 'text-foreground',
    },
  ] as const;

  return (
    <section className="flex flex-col">
      <HeadlineFigure
        label={t('atRiskLabel')}
        value={money(exposure.valueAtRisk)}
        caption={t('batchSummary', {
          batches: exposure.batchCount,
          expired: buckets[0].rows.length,
        })}
      />

      {/* Three cells that filter by scroll rather than by state — anchors, no
          client JS, and the counts stay visible while you read the list. */}
      <nav aria-label={t('bucketsLabel')} className="bg-muted/50 grid grid-cols-3 border-y">
        {buckets.map((b) => (
          <a
            key={b.key}
            href={`#${b.key}`}
            className="flex h-15 flex-col justify-center gap-0.5 px-3 py-2"
          >
            <span className={`text-xl font-semibold ${b.tone}`}>{b.rows.length}</span>
            <span className="text-muted-foreground text-[13px]">{t(`buckets.${b.key}`)}</span>
          </a>
        ))}
      </nav>

      <div className="p-4">
        <DataList>
          {/* Each header immediately followed by its own rows, so the sticky
              header is always the one describing what is on screen. */}
          {buckets.flatMap((bucket) =>
            bucket.rows.length === 0
              ? []
              : [
                  <DataGroupHeader key={`${bucket.key}-header`}>
                    {/* The anchor sits on the header so the strip lands here. */}
                    <span id={bucket.key}>{t(`groups.${bucket.key}`)}</span>
                  </DataGroupHeader>,
                  ...bucket.rows.map((r) => {
                    const urgency = urgencyOf(r.daysRemaining);
                    return (
                      <DataRow
                        key={r.batchId}
                        tall
                        title={r.productName}
                        subtitle={
                          <UrgencyBadge
                            urgency={urgency}
                            label={
                              r.daysRemaining !== null && r.daysRemaining < 0
                                ? t('expiredDaysAgo', { days: Math.abs(r.daysRemaining) })
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
      </div>
    </section>
  );
}
