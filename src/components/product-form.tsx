import { getTranslations } from 'next-intl/server';

import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UNITS } from '@/db/schema';

type Defaults = {
  name?: string;
  gtin?: string | null;
  caseGtin?: string | null;
  isWeighed?: boolean;
  unitsPerCase?: string | null;
  unit?: string;
  costPrice?: string | null;
  sellPrice?: string | null;
  vatBand?: string | null;
  shelfLifeDays?: number | null;
  supplierId?: string | null;
  categoryId?: string | null;
};

/*
 * Rate ascending, so a UK grocer sees zero-rated first — it is the right answer
 * for most of their catalogue. VAT_BANDS' own order is schema order, not an
 * order anyone would want to read.
 */
const BAND_DISPLAY_ORDER = ['zero', 'super_reduced', 'reduced', 'standard'] as const;

export async function ProductForm({
  action,
  suppliers,
  categories,
  vatBands,
  defaults = {},
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** The tenant's own configured bands. Never a hardcoded country rate. */
  vatBands: { band: string; rate: string }[];
  defaults?: Defaults;
  error?: string;
}) {
  const t = await getTranslations('products');

  const ratesByBand = new Map(vatBands.map((v) => [v.band, v.rate]));
  const orderedBands = BAND_DISPLAY_ORDER.filter((b) => ratesByBand.has(b));
  const percent = (rate: string) => `${Number(rate) * 100}%`;

  return (
    <form action={action} className="flex flex-col gap-4 pb-20 sm:pb-0">
      <Field name="name" label={t('name')}>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-12" />
      </Field>

      <Field
        name="gtin"
        label={t('barcode')}
        error={error === 'barcode' ? t('invalidBarcode') : undefined}
      >
        {/* inputMode numeric gives the phone keypad. Typing a barcode must stay
            possible when the camera fails or permission is refused. */}
        <Input
          id="gtin"
          name="gtin"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaults.gtin ?? ''}
          className="h-12 font-mono"
        />
      </Field>

      <FieldRow>
        <Field
          name="caseGtin"
          label={t('caseBarcode')}
          error={error === 'caseBarcode' ? t('invalidBarcode') : undefined}
        >
          <Input
            id="caseGtin"
            name="caseGtin"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={defaults.caseGtin ?? ''}
            className="h-12 font-mono"
          />
        </Field>
        <Field name="unitsPerCase" label={t('unitsPerCase')}>
          <Input
            id="unitsPerCase"
            name="unitsPerCase"
            inputMode="numeric"
            defaultValue={defaults.unitsPerCase ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
      </FieldRow>

      <Field name="unit" label={t('unit')}>
        <NativeSelect id="unit" name="unit" defaultValue={defaults.unit ?? 'each'}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {/* A native checkbox rather than a component: it is keyboard accessible,
          announces itself correctly, and needs no JavaScript to work. */}
      <div className="flex items-start gap-3">
        <input
          id="isWeighed"
          name="isWeighed"
          type="checkbox"
          defaultChecked={defaults.isWeighed ?? false}
          className="border-input accent-primary mt-3 size-5 shrink-0 rounded"
        />
        <label htmlFor="isWeighed" className="flex flex-col gap-0.5 py-2">
          <span className="text-sm font-medium">{t('isWeighed')}</span>
          <span className="text-muted-foreground text-sm">{t('isWeighedHint')}</span>
        </label>
      </div>

      <FieldRow>
        <Field name="costPrice" label={t('cost')} hint={t('costHint')}>
          <Input
            id="costPrice"
            name="costPrice"
            inputMode="decimal"
            defaultValue={defaults.costPrice ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
        <Field name="sellPrice" label={t('price')} hint={t('priceHint')}>
          <Input
            id="sellPrice"
            name="sellPrice"
            inputMode="decimal"
            defaultValue={defaults.sellPrice ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
      </FieldRow>

      {/* Most UK food is zero-rated; confectionery, crisps, soft drinks and hot
          food are not. A single aisle crosses both, so this cannot be inferred
          from the country and has to be set per product. */}
      <Field name="vatBand" label={t('vatBand')} hint={t('vatBandHint')}>
        <NativeSelect id="vatBand" name="vatBand" defaultValue={defaults.vatBand ?? 'zero'}>
          {orderedBands.map((b) => (
            <option key={b} value={b}>
              {t(`vatBands.${b}`)} — {percent(ratesByBand.get(b)!)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field name="shelfLifeDays" label={t('shelfLife')}>
        <Input
          id="shelfLifeDays"
          name="shelfLifeDays"
          inputMode="numeric"
          defaultValue={defaults.shelfLifeDays ?? ''}
          className="h-12 text-right tabular-nums"
        />
      </Field>

      <Field name="supplierId" label={t('supplier')}>
        <NativeSelect id="supplierId" name="supplierId" defaultValue={defaults.supplierId ?? ''}>
          <option value="">{t('noSupplier')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field name="categoryId" label={t('category')}>
        <NativeSelect id="categoryId" name="categoryId" defaultValue={defaults.categoryId ?? ''}>
          <option value="">{t('noCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {error === 'unknown' && (
        <p role="alert" className="text-destructive text-sm">
          {t('saveFailed')}
        </p>
      )}

      <StickyAction>
        <Button type="submit" className="h-12 w-full sm:w-fit">
          {t('save')}
        </Button>
      </StickyAction>
    </form>
  );
}

/** Shared between create and edit so the two forms cannot drift apart. */
export function productInputFrom(formData: FormData) {
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  return {
    name: String(formData.get('name') ?? ''),
    gtin: value('gtin'),
    caseGtin: value('caseGtin'),
    unitsPerCase: value('unitsPerCase'),
    // An unchecked box posts nothing at all, so absence is false.
    isWeighed: formData.get('isWeighed') !== null,
    unit: (value('unit') ?? 'each') as (typeof UNITS)[number],
    // Money stays a string all the way to the database.
    costPrice: value('costPrice'),
    // The shelf price, VAT included. The till extracts VAT from it rather than
    // adding VAT on top — see server/pos/checkout.ts.
    sellPrice: value('sellPrice'),
    vatBand: (value('vatBand') ?? 'zero') as 'standard' | 'reduced' | 'super_reduced' | 'zero',
    supplierId: value('supplierId'),
    categoryId: value('categoryId'),
    shelfLifeDays: value('shelfLifeDays') ? Number(value('shelfLifeDays')) : null,
  };
}
