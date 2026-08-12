import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BarcodeField } from '@/components/barcode-field';
import { Field, NativeSelect, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { REASON_CODES } from '@/db/schema';
import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { findProductByBarcode } from '@/server/catalog/products';
import { InsufficientStockError } from '@/server/stock/fefo';
import { getProductStock } from '@/server/stock/levels';
import { recordWaste } from '@/server/stock/movements';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function WastePage({ params, searchParams }: PageProps<'/[locale]/waste'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, error, done } = await searchParams;
  const t = await getTranslations('waste');
  const { orgId } = await requireOrg(locale);

  const barcode = typeof gtin === 'string' ? gtin : undefined;
  const product = barcode ? await findProductByBarcode(orgId, barcode) : null;
  const [stock] = product ? await getProductStock(orgId, product.id) : [];

  async function write(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    const productId = String(formData.get('productId') ?? '');
    const quantity = String(formData.get('quantity') ?? '').trim();
    const reasonCode = String(formData.get('reasonCode') ?? 'expired') as (typeof REASON_CODES)[number];

    try {
      // No batch given: deplete FEFO, so the nearest-expiry stock clears first.
      await recordWaste(orgId, { productId, quantity, reasonCode, actorId: userId });
    } catch (e) {
      const code = e instanceof InsufficientStockError ? 'stock' : 'unknown';
      redirect(`/${locale}/waste?gtin=${formData.get('gtin')}&error=${code}`);
    }
    redirect(`/${locale}/waste?done=1`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <PageTitle>{t('title')}</PageTitle>

      {done && (
        <p role="status" className="text-sm">
          {t('recorded')}
        </p>
      )}

      {/* Step one: identify the product. GET, so the barcode lands in the URL
          and a mis-scan is corrected by editing the field, not restarting. */}
      <form className="flex flex-col gap-3">
        <BarcodeField defaultValue={barcode ?? ''} />
        <Button type="submit" variant="outline" className="h-11 w-fit">
          {t('lookUp')}
        </Button>
      </form>

      {barcode && !product && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm">
            {t('notFound', { barcode })}
          </p>
          <Link
            href={`/${locale}/products/new`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('addProduct')}
          </Link>
        </div>
      )}

      {product && (
        <form action={write} className="flex flex-col gap-4">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="gtin" value={barcode} />

          <div className="flex flex-col gap-1">
            <span className="text-lg font-medium">{product.name}</span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {trimQuantity(stock?.quantity ?? '0')} <span className="opacity-70">{product.unit}</span>{' '}
              {t('onHand')}
            </span>
          </div>

          <Field
            name="quantity"
            label={t('quantity')}
            error={error === 'stock' ? t('notEnoughStock') : undefined}
          >
            <Input
              id="quantity"
              name="quantity"
              inputMode="decimal"
              required
              className="h-14 text-right text-lg tabular-nums"
            />
          </Field>

          <Field name="reasonCode" label={t('reason')}>
            <NativeSelect id="reasonCode" name="reasonCode" defaultValue="expired">
              {REASON_CODES.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {error === 'unknown' && (
            <p role="alert" className="text-destructive text-sm">
              {t('failed')}
            </p>
          )}

          {/* One primary action, bottom third, thumb-reachable. */}
          <StickyAction>
            <Button type="submit" className="h-12 w-full sm:w-fit">
              {t('submit')}
            </Button>
          </StickyAction>
        </form>
      )}
    </main>
  );
}
