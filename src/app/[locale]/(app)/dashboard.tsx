import { getFormatter, getTranslations } from 'next-intl/server';

import { DataList, DataRow, HeadlineFigure } from '@/components/data-list';
import { UrgencyBadge, urgencyClass, urgencyOf } from '@/components/expiry-urgency';
import { FirstRun } from '@/components/first-run';
import { countProducts } from '@/server/catalog/import';
import { getExpiringStock, getExpiryExposure, getProductStock } from '@/server/stock/levels';

/**
 * The expiry dashboard. Per the spec this is the homepage — what is about to go
 * off, worst first, with the money at stake stated up front.
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

  // Display only — no arithmetic is done on these, so leaving string space here
  // does not risk the float rounding the rest of the codebase avoids.
  const money = (v: string | null) =>
    format.number(Number(v ?? 0), { style: 'currency', currency });

  if (rows.length === 0) {
    // Nothing expiring means one of two very different things: a shop with no
    // data yet, or a shop that is on top of things. Telling them apart is the
    // difference between guidance and a dead end.
    const [productCount, stock] = await Promise.all([
      countProducts(orgId),
      getProductStock(orgId),
    ]);
    if (productCount === 0 || stock.length === 0) {
      return <FirstRun locale={locale} hasProducts={productCount > 0} hasStock={stock.length > 0} />;
    }

    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('nothingExpiring')}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Number before label, per the house rule: "12 expiring", not "Expiring: 12". */}
      <HeadlineFigure
        value={money(exposure.valueAtRisk)}
        label={t('atRisk')}
        sub={t('batchCount', { count: exposure.batchCount })}
      />

      <DataList>
        {rows.map((r) => {
          const urgency = urgencyOf(r.daysRemaining);
          return (
            <DataRow
              key={r.batchId}
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
                  {r.quantity} <span className="opacity-70">{t('units')}</span>
                </>
              }
            />
          );
        })}
      </DataList>
    </section>
  );
}
