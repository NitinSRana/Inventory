import Decimal from 'decimal.js';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Image as ImageIcon, PackageSearch } from 'lucide-react';

import { BarcodeField } from '@/components/barcode-field';
import { DataList, DataRow, PageTitle, SectionHeading } from '@/components/data-list';
import { UrgencyBadge, urgencyOf } from '@/components/expiry-urgency';
import { StickyAction } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { trimQuantity } from '@/lib/quantity';
import { roleAtLeast } from '@/server/auth/roles';
import { requireOrg } from '@/server/auth/session';
import { listCategories } from '@/server/catalog/categories';
import { parseGs1 } from '@/server/catalog/gs1';
import { findProductByBarcode } from '@/server/catalog/products';
import { getProductBatches, getProductStock } from '@/server/stock/levels';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * What the header's Scan button opens: point at a product, see what it is.
 *
 * The redesign moved Receive and Count out of the tab bar and put this in front
 * of them, because an aisle task starts with a product in hand rather than with
 * a menu. So this screen is a doorway, not a destination — the stock and batches
 * answer "what is this and how much is there", and the one primary action is
 * the most common next step, receiving it.
 *
 * Laid out as frame 4:617 ("Scan Result"). Two departures: the frame offers a
 * single "Log Adjustment", which on its own would have left counting with no way
 * in on a phone, so the other next steps are here as secondary links. And the
 * category chip is neutral, not blue — blue means "you can go here", and the
 * chip goes nowhere.
 *
 * Typing a barcode completes the flow without the camera, as every scan flow
 * here must.
 */
export default async function ScanPage({ params, searchParams }: PageProps<'/[locale]/scan'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin } = await searchParams;
  const t = await getTranslations('scan');
  const tProducts = await getTranslations('products');
  const format = await getFormatter();
  const { orgId, role } = await requireOrg(locale);
  const canManage = roleAtLeast(role, 'manager');

  const code = typeof gtin === 'string' ? gtin.trim() : '';
  // A supplier's GS1 box label names the product inside it, exactly as Receive
  // reads it; a plain barcode comes back null and is looked up unchanged.
  const lookupCode = (code ? parseGs1(code)?.gtin : null) ?? code;
  const product = lookupCode ? await findProductByBarcode(orgId, lookupCode) : null;

  const stock = product ? await getProductStock(orgId, product.id) : [];
  const batches = product ? await getProductBatches(orgId, product.id) : [];
  const category =
    product?.categoryId != null
      ? (await listCategories(orgId)).find((c) => c.id === product.categoryId)
      : undefined;
  const onHand = stock.reduce((sum, s) => sum.plus(s.quantity ?? '0'), new Decimal(0)).toString();

  async function lookUp(formData: FormData) {
    'use server';
    const next = String(formData.get('gtin') ?? '').trim();
    redirect(`/${locale}/scan${next ? `?gtin=${encodeURIComponent(next)}` : ''}`);
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-28">
      <PageTitle caption={t('pageIntro')}>{t('pageTitle')}</PageTitle>

      {/* Stays live after a result, so the next product is one scan away rather
          than a back-tap and a scan. */}
      <form action={lookUp}>
        <BarcodeField defaultValue={code} autoFocus={!product} />
      </form>

      {code && !product && (
        <div role="alert" className="bg-card flex flex-col items-start gap-2 rounded-xl border p-4">
          <PackageSearch aria-hidden className="text-muted-foreground size-6" />
          <p className="font-semibold">{t('notFound')}</p>
          <p className="text-muted-foreground text-sm">
            {canManage ? t('notFoundBody') : t('notFoundAskManager')}
          </p>
          {canManage && (
            <Link
              href={`/${locale}/products/new?gtin=${encodeURIComponent(lookupCode)}`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('addProduct')}
            </Link>
          )}
        </div>
      )}

      {product && (
        <>
          <section className="bg-card flex items-center gap-4 rounded-xl border p-4">
            {/* The catalogue holds no product photos; the frame draws this same
                empty image tile for that case. */}
            <span className="bg-muted flex size-16 shrink-0 items-center justify-center rounded-lg border">
              <ImageIcon aria-hidden className="text-muted-foreground size-6" />
            </span>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <p className="font-bold">{product.name}</p>
              {product.sku && <p className="text-muted-foreground text-sm">{product.sku}</p>}
              {category && (
                <Badge variant="outline">
                  {category.icon ? `${category.icon} ` : ''}
                  {category.name}
                </Badge>
              )}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-card flex flex-col gap-1 rounded-lg border p-3">
              <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                {t('currentStock')}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {trimQuantity(onHand)} <span className="text-sm font-normal opacity-70">{product.unit}</span>
              </span>
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <SectionHeading>{t('batches', { count: batches.length })}</SectionHeading>
            {batches.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noBatches')}</p>
            ) : (
              <DataList>
                {batches.map((b) => {
                  const days = b.daysRemaining;
                  return (
                    <DataRow
                      key={b.batchId}
                      title={b.lotNumber ?? '—'}
                      subtitle={
                        b.expiryDate
                          ? t('expires', {
                              date: format.dateTime(new Date(b.expiryDate), { dateStyle: 'medium' }),
                            })
                          : t('noExpiry')
                      }
                      value={trimQuantity(b.quantity ?? '0')}
                      meta={
                        days === null ? (
                          <span className="opacity-70">{product.unit}</span>
                        ) : (
                          <UrgencyBadge
                            urgency={urgencyOf(days)}
                            label={
                              days < 0
                                ? tProducts('expiredDaysAgo', { days: Math.abs(days) })
                                : tProducts('daysLeft', { days })
                            }
                          />
                        )
                      }
                    />
                  );
                })}
              </DataList>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/${locale}/products/${product.id}`}
              className={buttonVariants({ variant: 'outline', className: 'h-11' })}
            >
              {t('openProduct')}
            </Link>
            {canManage && (
              <Link
                href={`/${locale}/products/${product.id}/correct`}
                className={buttonVariants({ variant: 'outline', className: 'h-11' })}
              >
                {t('correctStock')}
              </Link>
            )}
            <Link href={`/${locale}/count`} className={buttonVariants({ variant: 'outline', className: 'h-11' })}>
              {t('startCount')}
            </Link>
          </div>

          {/* The one primary action, in the bottom third. The scanned code rides
              along, so a GS1 box label still prefills quantity, lot and expiry. */}
          <StickyAction>
            <Link
              href={`/${locale}/receive?gtin=${encodeURIComponent(code)}`}
              className={buttonVariants({ className: 'h-12 w-full sm:w-fit' })}
            >
              {t('receiveBatch')}
            </Link>
          </StickyAction>
        </>
      )}
    </main>
  );
}
