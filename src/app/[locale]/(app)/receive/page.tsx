import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check, Lock, Search } from 'lucide-react';

import { BarcodeField } from '@/components/barcode-field';
import { DateNudgeInput } from '@/components/date-nudge-field';
import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Decimal from 'decimal.js';

import { trimQuantity } from '@/lib/quantity';
import { roleAtLeast } from '@/server/auth/roles';
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

/**
 * Laid out as the "Receive Delivery" frame. Two departures, both on purpose:
 *
 * - The frame picks the product from a dropdown. A 2,000-product dropdown is
 *   unusable one-handed, so the product is still found by scanning; once found
 *   it sits in the same bordered box the frame draws, with a way to change it.
 * - The frame folds cases into the quantity field ("24 units (cases of 6)").
 *   Counting in cases stays an explicit choice, because a figure that silently
 *   means cases or units depending on context is how a delivery gets received
 *   six times over.
 *
 * Unit cost is manager-only, as the frame marks it — cost is manager+ on every
 * other screen. The action enforces that, not just the form.
 */
export default async function ReceivePage({ params, searchParams }: PageProps<'/[locale]/receive'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { gtin, done, error } = await searchParams;
  const t = await getTranslations('receive');
  const { orgId, role } = await requireOrg(locale);
  const canManage = roleAtLeast(role, 'manager');

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
    const { orgId, userId, role } = await requireOrg(locale);
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
        // Staff never set cost: a posted field is ignored and the batch takes
        // the product's own cost — what the pre-filled field used to submit.
        unitCost: roleAtLeast(role, 'manager') ? value('unitCost') : (fresh?.costPrice ?? null),
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
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {done && (
        <p role="status" className="bg-card flex items-center gap-2 rounded-lg border p-3 text-sm">
          <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.4} />
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
        <div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-4">
          <p role="alert" className="text-sm">
            {t('notFound', { barcode })}
          </p>
          {/* Carry the scanned code into the form — it is the whole reason
              this link is being offered. */}
          <Link
            href={`/${locale}/products/new?gtin=${encodeURIComponent(barcode)}`}
            className={buttonVariants({ variant: 'outline', className: 'h-11' })}
          >
            {t('addProduct')}
          </Link>
        </div>
      )}

      {product && (
        <form action={receive} className="flex flex-col gap-5">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="gtin" value={barcode} />

          <div className="flex flex-col gap-2 md:max-w-lg">
            <span className="text-sm font-medium">{t('product')}</span>
            <div className="bg-card flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2">
              <Search aria-hidden className="text-muted-foreground size-5 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-medium">{product.name}</span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {trimQuantity(stock?.quantity ?? '0')} <span className="opacity-70">{product.unit}</span>{' '}
                  {t('onHand')}
                </span>
              </span>
              <Link
                href={`/${locale}/receive`}
                className="text-link inline-flex min-h-11 shrink-0 items-center text-sm font-semibold"
              >
                {t('change')}
              </Link>
            </div>
          </div>

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
                  className="bg-card h-14 text-lg tabular-nums"
                />
              </Field>
              <Field name="entryUnit" label={t('countedIn')}>
                <NativeSelect
                  id="entryUnit"
                  name="entryUnit"
                  defaultValue={scannedTheCase ? 'case' : 'unit'}
                  className="bg-card h-14"
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
                className="bg-card h-14 text-lg tabular-nums"
              />
            </Field>
          )}

          {/* The frame's "Expiry Date (Use By)": which kind of date it is
              changes what happens after it passes — a use-by batch cannot be
              sold at all — so the label says which. */}
          <Field
            name="expiryDate"
            label={t('expiryOfType', { type: product.dateType })}
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

          <Field name="lotNumber" label={t('lotOptional')}>
            <Input
              id="lotNumber"
              name="lotNumber"
              autoComplete="off"
              defaultValue={label?.lotNumber ?? ''}
              className="bg-card h-12 font-mono"
            />
          </Field>

          {canManage && (
            <Field
              name="unitCost"
              label={
                <span className="flex w-full items-center justify-between gap-3">
                  {t('unitCostExVat')}
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
                    <Lock aria-hidden className="size-3" />
                    {t('managerOnly')}
                  </span>
                </span>
              }
              hint={product.unitsPerCase ? t('unitCostPerUnit') : undefined}
            >
              <Input
                id="unitCost"
                name="unitCost"
                inputMode="decimal"
                defaultValue={product.costPrice ?? ''}
                className="bg-card h-12 tabular-nums"
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {t('failed')}
            </p>
          )}

          <StickyAction>
            <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
              {t('submit')}
            </Button>
          </StickyAction>
        </form>
      )}
    </main>
  );
}
