import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BarcodeField } from '@/components/barcode-field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireOrg } from '@/server/auth/session';
import { findProductByBarcode } from '@/server/catalog/products';
import { getProductStock, suggestedExpiryDate } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function ReceivePage({ params, searchParams }: PageProps<'/[locale]/receive'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, done, error } = await searchParams;
  const t = await getTranslations('receive');
  const { orgId } = await requireOrg(locale);

  const barcode = typeof gtin === 'string' ? gtin : undefined;
  const product = barcode ? await findProductByBarcode(orgId, barcode) : null;
  const [stock] = product ? await getProductStock(orgId, product.id) : [];

  // Shelf life gives a sensible default expiry, which is the field people are
  // most likely to skip and most expensive to get wrong. The date comes from the
  // database so it agrees with the dashboard's current_date.
  const suggestedExpiry =
    product?.shelfLifeDays != null
      ? ((await suggestedExpiryDate(orgId, product.shelfLifeDays)) ?? '')
      : '';

  async function lookUp(formData: FormData) {
    'use server';
    const code = String(formData.get('gtin') ?? '').trim();
    redirect(`/${locale}/receive?gtin=${encodeURIComponent(code)}`);
  }

  async function receive(formData: FormData) {
    'use server';
    const { orgId, userId } = await requireOrg(locale);
    const value = (key: string) => {
      const v = formData.get(key);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };

    try {
      await receiveStock(orgId, {
        productId: String(formData.get('productId')),
        quantity: String(formData.get('quantity') ?? '').trim(),
        expiryDate: value('expiryDate'),
        lotNumber: value('lotNumber'),
        unitCost: value('unitCost'),
        actorId: userId,
      });
    } catch {
      redirect(`/${locale}/receive?gtin=${formData.get('gtin')}&error=1`);
    }
    redirect(`/${locale}/receive?done=1`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      {done && (
        <p role="status" className="text-sm">
          {t('received')}
        </p>
      )}

      {!product && (
        <form action={lookUp} className="flex flex-col gap-3">
          <BarcodeField defaultValue={barcode ?? ''} autoFocus />
          <Button type="submit" variant="outline" className="h-11 w-fit">
            {t('lookUp')}
          </Button>
        </form>
      )}

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
        <form action={receive} className="flex flex-col gap-4">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="gtin" value={barcode} />

          <div className="flex flex-col gap-1">
            <span className="text-lg font-medium">{product.name}</span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {stock?.quantity ?? '0'} <span className="opacity-70">{product.unit}</span>{' '}
              {t('onHand')}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="quantity">{t('quantity', { unit: product.unit })}</Label>
            <Input
              id="quantity"
              name="quantity"
              inputMode="decimal"
              required
              autoFocus
              className="h-12 text-right tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="expiryDate">{t('expiry')}</Label>
            {/* Native date input: the OS picker beats any calendar widget on a
                phone, and it is one less thing to ship. */}
            <Input
              id="expiryDate"
              name="expiryDate"
              type="date"
              defaultValue={suggestedExpiry}
              className="h-12"
            />
            {product.shelfLifeDays != null && (
              <p className="text-muted-foreground text-xs">
                {t('expiryHint', { days: product.shelfLifeDays })}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="lotNumber">{t('lot')}</Label>
              <Input id="lotNumber" name="lotNumber" autoComplete="off" className="h-12 font-mono" />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="unitCost">{t('unitCost')}</Label>
              <Input
                id="unitCost"
                name="unitCost"
                inputMode="decimal"
                defaultValue={product.costPrice ?? ''}
                className="h-12 text-right tabular-nums"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t('failed')}
            </p>
          )}

          <Button type="submit" className="fixed inset-x-4 bottom-6 h-12 sm:static sm:w-fit">
            {t('submit')}
          </Button>
        </form>
      )}
    </main>
  );
}
