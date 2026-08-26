import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BarcodeField } from '@/components/barcode-field';
import { DateNudgeInput } from '@/components/date-nudge-field';
import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Decimal from 'decimal.js';

import { trimQuantity } from '@/lib/quantity';
import { requireOrg } from '@/server/auth/session';
import { normalizeGtin } from '@/server/catalog/ean';
import { parseGs1 } from '@/server/catalog/gs1';
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
  // A supplier's box label, if that's what was scanned — quantity, lot,
  // expiry and (rarely, see gs1.ts) weight, not just an identifier. Returns
  // null for a plain barcode, so `lookupCode` below falls back unchanged.
  const label = barcode ? parseGs1(barcode) : null;
  const lookupCode = label?.gtin ?? barcode;
  const product = lookupCode ? await findProductByBarcode(orgId, lookupCode) : null;
  // What was actually pointed at. Scanning the carton means the delivery is
  // being counted in cartons, so that is the sensible default.
  const scannedTheCase = Boolean(
    product?.caseGtin && lookupCode && normalizeGtin(lookupCode) === product.caseGtin,
  );
  const [stock] = product ? await getProductStock(orgId, product.id) : [];

  // The label's own expiry wins when there is one — it's what's actually on
  // this delivery, not a guess from average shelf life. Falls back exactly
  // as before when the scan was a plain barcode.
  const suggestedExpiry =
    label?.expiryDate ??
    (product?.shelfLifeDays != null
      ? ((await suggestedExpiryDate(orgId, product.shelfLifeDays)) ?? '')
      : '');

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

          {/* Expiry first: the field most likely to get skipped and the most
              expensive to get wrong, so it gets the arriving focus ring and
              a box in the other hand doesn't have to fight the date picker
              for a one-day correction. */}
          <Field
            name="expiryDate"
            label={t('expiry')}
            hint={
              label?.expiryDate
                ? t('expiryFromLabel')
                : product.shelfLifeDays != null
                  ? t('expiryHint', { days: product.shelfLifeDays })
                  : undefined
            }
          >
            <DateNudgeInput
              id="expiryDate"
              name="expiryDate"
              defaultValue={suggestedExpiry}
              labels={{ minusDay: t('nudgeMinusDay'), plusDay: t('nudgePlusDay'), plusWeek: t('nudgePlusWeek') }}
            />
          </Field>

          {/* A product that comes in cases can be counted in cases — the boxes
              are what is stacked at the door, and the multiplication is the
              app's job. Defaults to cases when the case barcode was the thing
              scanned, because that is what the scanner was pointed at. */}
          {product.unitsPerCase ? (
            <FieldRow>
              <Field name="quantity" label={t('quantityReceived')}>
                <Input
                  id="quantity"
                  name="quantity"
                  inputMode="decimal"
                  required
                  // The label's AI 37 counts items inside the one case just
                  // scanned — a units figure, not a case count. Applying it
                  // here when entryUnit defaults to "case" would multiply it
                  // by unitsPerCase again and silently over-receive, so it
                  // only pre-fills when the default entry mode is units.
                  defaultValue={!scannedTheCase ? (label?.quantity ?? '') : ''}
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
          ) : (
            <Field name="quantity" label={t('quantity', { unit: product.unit })}>
              <Input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                required
                defaultValue={label?.quantity ?? ''}
                className="h-14 text-right text-lg tabular-nums"
              />
            </Field>
          )}

          {/* Anything else on the label — company-internal AIs (91-99) most
              often, whose meaning is whichever the supplier decided. Never
              guessed at or auto-filled (see gs1.ts) — shown raw so a person
              can read it and type the relevant part into Unit cost below. */}
          {label && label.extra.length > 0 && (
            <div className="bg-muted flex flex-col gap-1 rounded-lg p-3 text-sm">
              <span className="font-medium">{t('alsoOnLabel')}</span>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {label.extra.map((e, i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted-foreground font-mono">{e.ai}</dt>
                    <dd className="font-mono">{e.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <FieldRow>
            <Field name="lotNumber" label={t('lot')}>
              <Input
                id="lotNumber"
                name="lotNumber"
                autoComplete="off"
                defaultValue={label?.lotNumber ?? ''}
                className="h-12 font-mono"
              />
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
