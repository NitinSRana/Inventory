import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import { FilePen, Lock, PackageX, Pencil, Plus } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { DataList, DataRow, PageTitle, SectionHeading, StatTile } from '@/components/data-list';
import { EmptyState } from '@/components/empty-state';
import { UrgencyBadge, urgencyOf } from '@/components/expiry-urgency';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { MOVEMENT_TYPES, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { trimQuantity } from '@/lib/quantity';
import { LIST_LIMITS, limitFrom, one, pick } from '@/lib/search-params';
import { roleAtLeast } from '@/server/auth/roles';
import { requireOrg } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';
import { getProduct } from '@/server/catalog/products';
import { getDaysOfCover } from '@/server/consumption/calculate';
import { marginPercent as computeMarginPercent } from '@/server/settings/valuation';
import { getRatesByBand } from '@/server/settings/vat';
import { getProductBatches, getProductMovements, getProductStock } from '@/server/stock/levels';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * What a product actually is right now.
 *
 * Staff-readable on purpose. Every screen that names a product — the expiry
 * dashboard, the count queue, the scan result — wants to send someone here,
 * and all of them are screens staff use. Editing stays behind manager, one
 * click away, which is the only part that was ever manager work.
 *
 * Cost price is the exception: it is the shop's buying position and its margin,
 * so it — and the margin tile and batch values built on it — is shown to
 * manager and above. Sell price is on the shelf edge already.
 *
 * Laid out as the "Product Detail" frame: figure tiles, a price card, Stock
 * batches | Movements tabs, then Receive batch and Stock correct. The tabs are
 * links (`?tab=movements`), so each is a URL and no client JS is needed. Days
 * cover and margin stay in the foreground colour; the frame tints them amber
 * and green, and colour here means expiry.
 */
export default async function ProductPage({
  params,
  searchParams,
}: PageProps<'/[locale]/products/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('products');
  const tBack = await getTranslations('back');
  const format = await getFormatter();
  const { orgId, role } = await requireOrg(locale);
  const canManage = roleAtLeast(role, 'manager');

  // Namespaced `mv`: this is a detail page carrying several sections, and a
  // bare `type` or `limit` would collide the moment a second one grows a filter.
  const sp = await searchParams;
  const movementType = pick(sp.mv, MOVEMENT_TYPES);
  const movementLimit = limitFrom(sp.mvLimit);
  // A movement filter in the URL means someone is reading movements.
  const tab = one(sp.tab) === 'movements' || movementType || sp.mvLimit ? 'movements' : 'batches';

  // RLS scopes this, so another tenant's id is indistinguishable from a missing one.
  const product = await getProduct(orgId, id);
  if (!product) notFound();

  const [[org], stock, batches, movements, categories] = await Promise.all([
    withTenant(orgId, (tx) => tx.select().from(organizations)),
    getProductStock(orgId, id),
    getProductBatches(orgId, id),
    getProductMovements(orgId, id, { limit: movementLimit, type: movementType }),
    product.categoryId ? listCategories(orgId) : Promise.resolve([]),
  ]);
  const category = categories.find((c) => c.id === product.categoryId);

  const movementHref = (next: { mv?: string; mvLimit?: number }) => {
    const q = new URLSearchParams({ tab: 'movements' });
    const mv = next.mv ?? movementType;
    const lim = next.mvLimit ?? movementLimit;
    if (mv) q.set('mv', mv);
    if (lim !== LIST_LIMITS[0]) q.set('mvLimit', String(lim));
    return `/${locale}/products/${id}?${q}#movements`;
  };
  const nextMovementLimit = LIST_LIMITS[LIST_LIMITS.indexOf(movementLimit) + 1];

  const money = (v: string | null) =>
    v === null ? '—' : format.number(Number(v), { style: 'currency', currency: org.currencyCode });
  const onHand = stock.reduce((sum, s) => sum.plus(s.quantity ?? '0'), new Decimal(0)).toString();
  const daysOfCover = await getDaysOfCover(orgId, id, onHand);

  // Margin against cost — manager-only, alongside the cost figure itself.
  // See settings/valuation.ts's marginPercent() for why this isn't a naive
  // (sell - cost) / sell.
  let marginPercent: string | null = null;
  if (canManage && product.costPrice && product.sellPrice) {
    const rates = await getRatesByBand(orgId);
    const rate = rates[product.vatBand as keyof typeof rates] ?? '0';
    marginPercent = computeMarginPercent(product.sellPrice, product.costPrice, rate);
  }

  const tabClass = (active: boolean) =>
    `-mb-px inline-flex min-h-11 items-center border-b-2 px-1 text-sm ${
      active ? 'border-foreground font-semibold' : 'text-muted-foreground border-transparent'
    }`;

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:max-w-4xl">
      <BackLink href={`/${locale}/products`} label={tBack('products')} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          caption={
            <span className="flex flex-wrap items-center gap-x-2">
              {product.gtin ? <span className="font-mono">{product.gtin}</span> : <span>{t('noBarcode')}</span>}
              {category && (
                <>
                  <span aria-hidden>•</span>
                  <span>{category.name}</span>
                </>
              )}
            </span>
          }
        >
          {product.name}
        </PageTitle>
        {canManage && (
          <Link
            href={`/${locale}/products/${id}/edit`}
            className={buttonVariants({ variant: 'outline', className: 'h-11 gap-1.5' })}
          >
            <Pencil aria-hidden className="size-4" />
            {t('edit')}
          </Link>
        )}
      </div>

      {/* The number someone came here for, before any of the detail. */}
      <div className={`grid gap-2 ${marginPercent !== null ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <StatTile label={t('onHandTile')}>
          {trimQuantity(onHand)} <span className="text-muted-foreground text-xs font-semibold">{product.unit}</span>
        </StatTile>
        {/* One number, not a forecast: how long what's on the shelf lasts at
            the pace it's actually been selling. A dash below two counts rather
            than a confident guess dressed up as data. */}
        <StatTile
          label={t('daysCoverTile')}
          caption={daysOfCover === null ? <span className="line-clamp-2">{t('daysOfCoverUnknown')}</span> : undefined}
        >
          {daysOfCover === null ? (
            '—'
          ) : (
            <>
              {Math.round(daysOfCover)}{' '}
              <span className="text-muted-foreground text-xs font-semibold">
                {t('daysUnit', { days: Math.round(daysOfCover) })}
              </span>
            </>
          )}
        </StatTile>
        {marginPercent !== null && <StatTile label={t('marginTile')}>{marginPercent}%</StatTile>}
      </div>

      <section className="bg-card flex items-start justify-between gap-4 rounded-xl border p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">{t('sellPriceGross')}</span>
          <span className="text-lg font-bold tabular-nums">
            {product.sellPrice ? t('perUnit', { price: money(product.sellPrice), unit: product.unit }) : '—'}
          </span>
          {/* The band sits beside the price because it is only meaningful
              there: a product on the wrong band overcharges at the till. */}
          <span className="text-muted-foreground text-xs">{t(`vatBands.${product.vatBand}`)}</span>
        </div>
        {canManage && (
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Lock aria-hidden className="size-3" />
              {t('costPriceNet')}
            </span>
            <span className="text-lg font-bold tabular-nums">
              {product.costPrice ? t('perUnit', { price: money(product.costPrice), unit: product.unit }) : '—'}
            </span>
          </div>
        )}
      </section>

      {/* SKU, case barcode, units/case, shelf and shelf life — a cashier checking
          a case barcode before receiving shouldn't need the edit form for it. */}
      {(product.sku || product.caseGtin || product.unitsPerCase || product.shelfLocation || product.shelfLifeDays !== null) && (
        <section className="flex flex-col gap-2">
          <SectionHeading>{t('details')}</SectionHeading>
          <dl className="bg-card grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border p-4 text-sm sm:grid-cols-4">
            {product.sku && (
              <div>
                <dt className="text-muted-foreground text-xs">{t('sku')}</dt>
                <dd className="font-mono">{product.sku}</dd>
              </div>
            )}
            {product.shelfLocation && (
              <div>
                <dt className="text-muted-foreground text-xs">{t('shelfLocation')}</dt>
                <dd>{product.shelfLocation}</dd>
              </div>
            )}
            {product.caseGtin && (
              <div>
                <dt className="text-muted-foreground text-xs">{t('caseBarcode')}</dt>
                <dd className="font-mono">{product.caseGtin}</dd>
              </div>
            )}
            {product.unitsPerCase && (
              <div>
                <dt className="text-muted-foreground text-xs">{t('unitsPerCase')}</dt>
                <dd className="tabular-nums">{trimQuantity(product.unitsPerCase)}</dd>
              </div>
            )}
            {product.shelfLifeDays !== null && (
              <div>
                <dt className="text-muted-foreground text-xs">{t('shelfLife')}</dt>
                <dd className="tabular-nums">{product.shelfLifeDays}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <nav aria-label={t('tabsLabel')} className="flex gap-6 border-b">
        <Link
          href={`/${locale}/products/${id}`}
          aria-current={tab === 'batches' ? 'page' : undefined}
          className={tabClass(tab === 'batches')}
        >
          {t('batchesTab', { count: batches.length })}
        </Link>
        <Link
          href={`/${locale}/products/${id}?tab=movements#movements`}
          aria-current={tab === 'movements' ? 'page' : undefined}
          className={tabClass(tab === 'movements')}
        >
          {t('movementsTab')}
        </Link>
      </nav>

      {tab === 'batches' ? (
        <section className="flex flex-col gap-4">
          {batches.length === 0 ? (
            <EmptyState icon={PackageX} title={t('noStock')} body={t('noStockBody')} />
          ) : (
            <DataList>
              {batches.map((b) => {
                const days = b.daysRemaining;
                const quantity = b.quantity ?? '0';
                return (
                  <DataRow
                    key={b.batchId}
                    // A manager marks a batch down from its own row: the markdown
                    // belongs to this batch, not to the product.
                    href={canManage ? `/${locale}/products/${id}/markdown?batch=${b.batchId}` : undefined}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {b.expiryDate
                          ? t('expiresOn', {
                              date: format.dateTime(new Date(b.expiryDate), { dateStyle: 'medium' }),
                            })
                          : t('noExpiry')}
                        {days !== null && (
                          <UrgencyBadge
                            urgency={urgencyOf(days)}
                            label={days < 0 ? t('expiredDaysAgo', { days: Math.abs(days) }) : t('daysLeft', { days })}
                          />
                        )}
                      </span>
                    }
                    subtitle={
                      <span className="flex flex-wrap items-center gap-2">
                        {b.lotNumber && <span>{t('lotLabel', { lot: b.lotNumber })}</span>}
                        {b.expiryDate && <span>{t(`dateTypes.${b.dateType}`)}</span>}
                        {b.markdownPrice && (
                          <Badge variant="outline">{t('reducedTo', { price: money(b.markdownPrice) })}</Badge>
                        )}
                      </span>
                    }
                    value={
                      <>
                        {trimQuantity(quantity)} <span className="font-normal opacity-70">{product.unit}</span>
                      </>
                    }
                    meta={
                      canManage && b.unitCost
                        ? t('batchValue', { value: money(new Decimal(quantity).times(b.unitCost).toFixed(2)) })
                        : undefined
                    }
                  />
                );
              })}
            </DataList>
          )}
        </section>
      ) : (
        <section id="movements" className="flex scroll-mt-16 flex-col gap-3">
          {/* Links, not a form: one filter with five values reads better as a row
              of choices than as a select plus an Apply button, and each one is a
              shareable URL. */}
          <nav aria-label={t('movementFilterLabel')} className="flex flex-wrap gap-2">
            <Link
              href={movementHref({ mv: '' })}
              aria-current={movementType ? undefined : 'page'}
              className={buttonVariants({ variant: movementType ? 'outline' : 'default', className: 'h-11' })}
            >
              {t('allMovements')}
            </Link>
            {MOVEMENT_TYPES.map((mt) => (
              <Link
                key={mt}
                href={movementHref({ mv: mt })}
                aria-current={movementType === mt ? 'page' : undefined}
                className={buttonVariants({ variant: movementType === mt ? 'default' : 'outline', className: 'h-11' })}
              >
                {t(`movementTypes.${mt}`)}
              </Link>
            ))}
          </nav>

          {movements.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {movementType ? t('noMovementsOfType') : t('noMovements')}
            </p>
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
                          <span className="text-muted-foreground">{t(`reasonCodes.${m.reasonCode}`)}</span>
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

          {/* Raise the ceiling rather than page — see the sales list. */}
          {movements.length === movementLimit && nextMovementLimit && (
            <Link
              href={movementHref({ mvLimit: nextMovementLimit })}
              className={buttonVariants({ variant: 'outline', className: 'h-11 w-fit' })}
            >
              {t('showMore', { count: nextMovementLimit })}
            </Link>
          )}
        </section>
      )}

      {/* The frame's pair under the batches. Receiving is open to staff, as the
          Receive screen is; correcting the ledger stays manager work. */}
      <div className={`grid gap-3 ${canManage ? 'grid-cols-2' : 'grid-cols-1'} sm:flex`}>
        <Link
          href={`/${locale}/receive${product.gtin ? `?gtin=${encodeURIComponent(product.gtin)}` : ''}`}
          className={buttonVariants({ className: 'h-12 gap-2 sm:px-6' })}
        >
          <Plus aria-hidden className="size-4" />
          {t('receiveBatch')}
        </Link>
        {canManage && (
          <Link
            href={`/${locale}/products/${id}/correct`}
            className={buttonVariants({ variant: 'outline', className: 'h-12 gap-2 sm:px-6' })}
          >
            <FilePen aria-hidden className="size-4" />
            {t('correctStock')}
          </Link>
        )}
      </div>
    </main>
  );
}
