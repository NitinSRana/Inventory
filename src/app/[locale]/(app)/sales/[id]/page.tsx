import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import { AlertTriangle } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { SectionHeading } from '@/components/data-list';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg, roleAtLeast } from '@/server/auth/session';
import { getSale } from '@/server/pos/checkout';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * A receipt, laid out as the frame: a voided banner when it applies, then one
 * card with the sale number, date, cashier and tender, the items, and the
 * money — net subtotal, VAT per band, gross total.
 *
 * The VAT is per band rather than one line, because a return has to be refunded
 * at the rate it was charged. The total stays in the foreground colour; the
 * frame makes it blue, and blue here means a link.
 */
export default async function SaleDetailPage({ params }: PageProps<'/[locale]/sales/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('sales');
  const tVat = await getTranslations('vat');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId, role } = await requireOrg(locale);

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const receipt = await getSale(orgId, id);
  if (!receipt) notFound();
  const { sale, lines, vatBreakdown, soldByName, voidedByName } = receipt;

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const money = (v: string) => format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const netTotal = new Decimal(sale.subtotal);
  const dateTime = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:max-w-xl">
      <BackLink href={`/${locale}/sales`} label={tBack('sales')} />

      {sale.status === 'voided' && (
        <div role="status" className="bg-destructive-subtle text-destructive flex items-start gap-2 rounded-xl border p-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold uppercase">{t('voidedBanner')}</span>
            {sale.voidedAt && (
              <span className="text-sm">
                {voidedByName
                  ? t('voidedBy', { name: voidedByName, date: dateTime(sale.voidedAt) })
                  : t('voidedOn', { date: dateTime(sale.voidedAt) })}
              </span>
            )}
          </div>
        </div>
      )}

      <section className="bg-card flex flex-col gap-4 rounded-xl border p-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-2xl font-bold tracking-tight">{sale.saleNumber}</h1>
          <p className="text-muted-foreground text-sm">
            {t('dateLine', { date: dateTime(new Date(sale.occurredAt ?? sale.createdAt)) })}
          </p>
          {soldByName && <p className="text-muted-foreground text-sm">{t('cashierLine', { name: soldByName })}</p>}
          <p className="text-muted-foreground text-sm">{t('tenderLine', { tender: t(`tenderTypes.${sale.tenderType}`) })}</p>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <SectionHeading>{t('items')}</SectionHeading>
          <ul className="flex flex-col gap-3">
            {lines.map((l) => {
              const reduced = new Decimal(l.unitPrice).lessThan(l.listPrice);
              return (
                // Product and price: a product can take two lines since markdowns.
                <li key={`${l.productId}-${l.unitPrice}`}>
                  <Link
                    href={`/${locale}/products/${l.productId}`}
                    className="grid min-h-11 grid-cols-[1fr_auto] items-center gap-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{l.name}</span>
                      <span className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                        {t('lineDetail', {
                          quantity: trimQuantity(l.quantity),
                          unit: l.unit,
                          price: money(l.unitPrice),
                        })}
                        {reduced && (
                          <>
                            <s className="opacity-70">{money(l.listPrice)}</s>
                            <Badge variant="outline">{t('reduced')}</Badge>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums">{money(l.lineTotal)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <dl className="flex flex-col gap-1 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('subtotalNet')}</dt>
            <dd className="tabular-nums">{money(netTotal.toFixed(2))}</dd>
          </div>
          {vatBreakdown.map((b) => (
            <div key={b.band} className="text-muted-foreground flex justify-between text-xs">
              <dt>{t('vatLine', { band: tVat(`bands.${b.band}`) })}</dt>
              <dd className="tabular-nums">{money(b.vat)}</dd>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between border-t pt-3">
            <dt className="text-base font-bold">{t('totalGross')}</dt>
            <dd className="text-2xl font-extrabold tabular-nums">{money(sale.total)}</dd>
          </div>
        </dl>
      </section>

      {sale.status !== 'voided' && roleAtLeast(role, 'manager') && (
        <Link
          href={`/${locale}/sales/${id}/void`}
          className={buttonVariants({ variant: 'outline', className: 'text-destructive h-11 w-full sm:w-fit' })}
        >
          {t('void')}
        </Link>
      )}
    </main>
  );
}
