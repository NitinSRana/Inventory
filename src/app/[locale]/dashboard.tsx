import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { UrgencyBadge, urgencyClass, urgencyOf } from '@/components/expiry-urgency';
import { buttonVariants } from '@/components/ui/button';
import { getExpiringStock, getExpiryExposure } from '@/server/stock/levels';

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

  // A hub, not a screen with five competing primary actions: equal weight, two
  // columns, every target comfortably past 44px for a gloved thumb.
  const actions = (
    <nav aria-label={t('actionsLabel')}>
      <ul className="grid grid-cols-2 gap-2">
        {(
          [
            ['receive', 'receive'],
            ['waste', 'writeOff'],
            ['count', 'startCount'],
            ['reorder', 'reorder'],
            ['products', 'viewProducts'],
            ['suppliers', 'suppliers'],
            ['orders', 'orders'],
            ['reports', 'reports'],
            ['settings/vat', 'settings'],
          ] as const
        ).map(([path, key]) => (
          <li key={path}>
            <Link
              href={`/${locale}/${path}`}
              className={buttonVariants({ variant: 'outline', className: 'h-12 w-full' })}
            >
              {t(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );

  // The empty state still carries the actions: "nothing expiring" is exactly
  // when someone is here to write something off or check the catalogue.
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('nothingExpiring')}</p>
        {actions}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Number before label, per the house rule: "12 expiring", not "Expiring: 12". */}
      <div className="flex flex-col gap-1">
        <p className="text-3xl font-semibold tabular-nums">
          {money(exposure.valueAtRisk)}{' '}
          <span className="text-muted-foreground text-base font-normal">{t('atRisk')}</span>
        </p>
        <p className="text-muted-foreground text-sm tabular-nums">
          {t('batchCount', { count: exposure.batchCount })}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const urgency = urgencyOf(r.daysRemaining);
          return (
            <li key={r.batchId} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate font-medium">{r.productName}</span>
                <UrgencyBadge
                  urgency={urgency}
                  label={
                    r.daysRemaining !== null && r.daysRemaining < 0
                      ? t('expiredDaysAgo', { days: Math.abs(r.daysRemaining) })
                      : t('daysLeft', { days: r.daysRemaining ?? 0 })
                  }
                />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`text-sm font-medium tabular-nums ${urgencyClass(urgency)}`}>
                  {money(r.valueAtRisk)}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {r.quantity} <span className="opacity-70">{t('units')}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {actions}
    </section>
  );
}
