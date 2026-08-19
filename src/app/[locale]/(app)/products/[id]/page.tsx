import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PackageX } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { DataList, DataRow, PageTitle, SectionHeading } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { UrgencyBadge, urgencyOf } from '@/components/expiry-urgency';
import { buttonVariants } from '@/components/ui/button';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { roleAtLeast } from '@/server/auth/roles';
import { requireOrg } from '@/server/auth/session';
import { getProduct } from '@/server/catalog/products';
import { getDaysOfCover } from '@/server/consumption/calculate';
import { getProductBatches, getProductMovements, getProductStock } from '@/server/stock/levels';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * What a product actually is right now.
 *
 * Staff-readable on purpose. Every screen that names a product — the expiry
 * dashboard, the count queue, the reorder list — wants to send someone here,
 * and all of them are screens staff use. Editing stays behind manager, one
 * click away, which is the only part that was ever manager work.
 *
 * Cost price is the exception: it is the shop's buying position and its margin,
 * so it is shown to manager and above. Sell price is on the shelf edge already.
 */
export default async function ProductPage({ params }: PageProps<'/[locale]/products/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('products');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId, role } = await requireOrg(locale);
  const canManage = roleAtLeast(role, 'manager');

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const [stock, batches, movements] = await Promise.all([
    getProductStock(orgId, id),
    getProductBatches(orgId, id),
    getProductMovements(orgId, id, 10),
  ]);

  const money = (v: string | null) =>
    v === null ? '—' : format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const onHand = stock.reduce((sum, s) => sum + Number(s.quantity ?? 0), 0);
  const daysOfCover = await getDaysOfCover(orgId, id, String(onHand));

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-24">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle caption={product.gtin ?? t('noBarcode')}>{product.name}</PageTitle>
        {canManage && (
          <div className="flex gap-2">
            <Link
              href={`/${locale}/products/${id}/correct`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('correctStock')}
            </Link>
            <Link
              href={`/${locale}/products/${id}/edit`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('edit')}
            </Link>
          </div>
        )}
      </div>

      {/* The number someone came here for, before any of the detail. */}
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-0.5">
          <SectionHeading>{t('onHand')}</SectionHeading>
          <p className="text-3xl font-semibold tabular-nums">
            {trimQuantity(String(onHand))}{' '}
            <span className="text-muted-foreground text-lg font-normal">{product.unit}</span>
          </p>
          {/* One number, not a forecast: how long what's on the shelf lasts at
              the pace it's actually been selling. Null below two counts rather
              than a confident guess dressed up as data. */}
          <p className="text-muted-foreground text-sm">
            {daysOfCover === null
              ? t('daysOfCoverUnknown')
              : t('daysOfCover', { days: Math.round(daysOfCover) })}
          </p>
        </div>
        <div className="flex flex-col gap-0.5">
          <SectionHeading>{t('price')}</SectionHeading>
          <p className="text-3xl font-semibold tabular-nums">{money(product.sellPrice)}</p>
          {/* The band is shown next to the price because it is only meaningful
              beside it: the price includes this VAT, and a product silently
              sitting on the wrong band overcharges the customer at the till. */}
          <p className="text-muted-foreground text-sm">
            {t(`vatBands.${product.vatBand}`)} · {t('vatIncluded')}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-col gap-0.5">
            <SectionHeading>{t('cost')}</SectionHeading>
            <p className="text-muted-foreground text-3xl font-semibold tabular-nums">
              {money(product.costPrice)}
            </p>
          </div>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <SectionHeading>{t('batches')}</SectionHeading>
        {batches.length === 0 ? (
          <EmptyState icon={PackageX} title={t('noStock')} body={t('noStockBody')} />
        ) : (
          <DataList>
            {batches.map((b) => {
              const days = b.daysRemaining;
              return (
                <DataRow
                  key={b.batchId}
                  title={b.expiryDate ?? t('noExpiry')}
                  subtitle={
                    days === null ? (
                      b.lotNumber ?? undefined
                    ) : (
                      <UrgencyBadge
                        urgency={urgencyOf(days)}
                        label={
                          days < 0
                            ? t('expiredDaysAgo', { days: Math.abs(days) })
                            : t('daysLeft', { days })
                        }
                      />
                    )
                  }
                  value={trimQuantity(b.quantity ?? '0')}
                  meta={<span className="opacity-70">{product.unit}</span>}
                />
              );
            })}
          </DataList>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeading>{t('recentMovements')}</SectionHeading>
        {movements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noMovements')}</p>
        ) : (
          <DataList>
            {movements.map((m) => {
              const added = !m.quantityDelta.startsWith('-');
              return (
                <DataRow
                  key={m.id}
                  title={t(`movementTypes.${m.movementType}`)}
                  subtitle={
                    <span className="flex flex-col">
                      <span>{format.dateTime(new Date(m.occurredAt), { dateStyle: 'medium' })}</span>
                      {m.reasonCode && (
                        <span className="text-muted-foreground">
                          {t(`reasonCodes.${m.reasonCode}`)}
                        </span>
                      )}
                      {/* The free-text reason a manager typed on a stock
                          correction — a required reason nobody can ever see
                          again is not worth requiring. */}
                      {m.note && <span className="text-muted-foreground">{m.note}</span>}
                    </span>
                  }
                  // Sign is carried by the character as well as the colour, so
                  // the direction survives greyscale and colour blindness.
                  value={`${added ? '+' : ''}${trimQuantity(m.quantityDelta)}`}
                  valueClassName={added ? '' : 'text-destructive'}
                />
              );
            })}
          </DataList>
        )}
      </section>
    </main>
  );
}
