import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BarcodeField } from '@/components/barcode-field';
import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Decimal from 'decimal.js';

import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { normalizeGtin } from '@/server/catalog/ean';
import { findProductByBarcode, getProduct } from '@/server/catalog/products';
import { getProductStock, suggestedExpiryDate } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';
import { PageTitle } from '@/components/data-list';

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
  // What was actually pointed at. Scanning the carton means the delivery is
  // being counted in cartons, so that is the sensible default.
  const scannedTheCase = Boolean(
    product?.caseGtin && barcode && normalizeGtin(barcode) === product.caseGtin,
  );
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

    const productId = String(formData.get('productId'));
    // Read once and reused below: the case-size multiplier and the date-type
    // classification both come from the database, never the form — the same
    // "not a figure to accept from the page" reasoning applies to both.
    const fresh = await getProduct(orgId, productId);

    // A delivery arrives in cases, so it can be counted in cases. The ledger
    // only ever stores units — the multiplication happens here, once, rather
    // than in someone's head at the back door with a box in the other hand.
    // Decimal because units_per_case is numeric too: 0.5 kg tubs, 6 to a tray.
    const typed = String(formData.get('quantity') ?? '').trim();
    let quantity = typed;
    if (formData.get('entryUnit') === 'case' && fresh?.unitsPerCase) {
      quantity = new Decimal(typed).times(fresh.unitsPerCase).toString();
    }

    try {
      await receiveStock(orgId, {
        productId,
        quantity,
        expiryDate: value('expiryDate'),
        lotNumber: value('lotNumber'),
        unitCost: value('unitCost'),
        dateType: fresh?.dateType,
        actorId: userId,
      });
    } catch {
      redirect(`/${locale}/receive?gtin=${formData.get('gtin')}&error=1`);
    }
    redirect(`/${locale}/receive?done=1`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <PageTitle>{t('title')}</PageTitle>

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
              {trimQuantity(stock?.quantity ?? '0')} <span className="opacity-70">{product.unit}</span>{' '}
              {t('onHand')}
            </span>
          </div>

          {/* The one number typed while holding the box: taller than the rest.
              A product that comes in cases can be counted in cases — the boxes
              are what is stacked at the door, and the multiplication is the
              app's job. Defaults to cases when the case barcode was the thing
              scanned, because that is what the scanner was pointed at. */}
          {product.unitsPerCase ? (
            <>
              <FieldRow>
                <Field name="quantity" label={t('quantityReceived')}>
                  <Input
                    id="quantity"
                    name="quantity"
                    inputMode="decimal"
                    required
                    autoFocus
                    className="h-14 text-right text-lg tabular-nums"
                  />
                </Field>
                <Field name="entryUnit" label={t('countedIn')}>
                  <NativeSelect
                    id="entryUnit"
                    name="entryUnit"
                    defaultValue={scannedTheCase ? 'case' : 'unit'}
                    className="h-14"
                  >
                    <option value="unit">{t('inUnits', { unit: product.unit })}</option>
                    <option value="case">
                      {t('inCases', { perCase: trimQuantity(product.unitsPerCase) })}
                    </option>
                  </NativeSelect>
                </Field>
              </FieldRow>
            </>
          ) : (
            <Field name="quantity" label={t('quantity', { unit: product.unit })}>
              <Input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                required
                autoFocus
                className="h-14 text-right text-lg tabular-nums"
              />
            </Field>
          )}

          <Field
            name="expiryDate"
            label={t('expiry')}
            hint={
              product.shelfLifeDays != null
                ? t('expiryHint', { days: product.shelfLifeDays })
                : undefined
            }
          >
            {/* Native date input: the OS picker beats any calendar widget on a
                phone, and it is one less thing to ship. */}
            <Input
              id="expiryDate"
              name="expiryDate"
              type="date"
              defaultValue={suggestedExpiry}
              className="h-12"
            />
          </Field>

          <FieldRow>
            <Field name="lotNumber" label={t('lot')}>
              <Input id="lotNumber" name="lotNumber" autoComplete="off" className="h-12 font-mono" />
            </Field>
            <Field
              name="unitCost"
              label={t('unitCost')}
              hint={product.unitsPerCase ? t('unitCostPerUnit') : undefined}
            >
              <Input
                id="unitCost"
                name="unitCost"
                inputMode="decimal"
                defaultValue={product.costPrice ?? ''}
                className="h-12 text-right tabular-nums"
              />
            </Field>
          </FieldRow>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t('failed')}
            </p>
          )}

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
