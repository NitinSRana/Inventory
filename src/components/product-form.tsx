import { getTranslations } from 'next-intl/server';
import Decimal from 'decimal.js';

import { Field, FieldPair, NativeSelect, Segmented, StickyAction, SwitchRow } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UNITS } from '@/db/schema';
import { trimQuantity } from '@/lib/quantity';

type Defaults = {
  name?: string;
  gtin?: string | null;
  caseGtin?: string | null;
  sku?: string | null;
  isWeighed?: boolean;
  unitsPerCase?: string | null;
  unit?: string;
  costPrice?: string | null;
  sellPrice?: string | null;
  vatBand?: string | null;
  dateType?: string | null;
  shelfLifeDays?: number | null;
  shelfLocation?: string | null;
  minStock?: string | null;
  maxStock?: string | null;
  supplierId?: string | null;
  categoryId?: string | null;
};

/*
 * Rate ascending, so a UK grocer sees zero-rated first — it is the right answer
 * for most of their catalogue. VAT_BANDS' own order is schema order, not an
 * order anyone would want to read.
 */
const BAND_DISPLAY_ORDER = ['zero', 'super_reduced', 'reduced', 'standard'] as const;

/**
 * Laid out as the "Create Product" / "Edit Product" frames: paired short fields,
 * segmented controls for unit, VAT band and date type, and "Sold by weight" as
 * a switch row.
 *
 * The frames drop a few fields between them (Edit has no supplier, SKU or stock
 * levels); both forms here keep every field, because updateProduct clears
 * whatever the form does not post — which is how SKUs were once being erased.
 * Shelf location, which neither frame shows, stays at the end.
 */
export async function ProductForm({
  action,
  suppliers,
  categories,
  vatBands,
  defaults = {},
  error,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string; icon?: string | null }[];
  /** The tenant's own configured bands. Never a hardcoded country rate. */
  vatBands: { band: string; rate: string }[];
  defaults?: Defaults;
  error?: string;
  submitLabel: string;
}) {
  const t = await getTranslations('products');

  const ratesByBand = new Map(vatBands.map((v) => [v.band, v.rate]));
  const orderedBands = BAND_DISPLAY_ORDER.filter((b) => ratesByBand.has(b));
  const percent = (rate: string) => `${new Decimal(rate).times(100).toString()}%`;
  // Quantities come back as numeric(14,3) strings: "16.000" reads as a typo.
  const qty = (v: string | null | undefined) => (v ? trimQuantity(v) : '');
  // A band with no configured rate cannot be sold (the till refuses it), but a
  // product already on one must still show where it is rather than silently
  // snapping to another band on save.
  const bandDefault = defaults.vatBand ?? (orderedBands[0] ?? 'zero');
  const bands = orderedBands.includes(bandDefault as (typeof orderedBands)[number])
    ? orderedBands
    : [...orderedBands, bandDefault];

  // pb-32 clears the sticky Save button, which sits 80px up and is 48px tall —
  // pb-20 left the last field underneath it. md, not sm: the button only stops
  // being fixed at md, so dropping the padding at sm removed the clearance
  // while the button was still floating.
  return (
    <form action={action} className="flex flex-col gap-5 pb-32 md:pb-0">
      <Field name="name" label={t('name')} required>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-12" />
      </Field>

      <FieldPair>
        <Field name="gtin" label={t('barcode')} error={error === 'barcode' ? t('invalidBarcode') : undefined}>
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
      </FieldPair>

      <FieldPair>
        <Field name="unitsPerCase" label={t('unitsPerCase')}>
          <Input
            id="unitsPerCase"
            name="unitsPerCase"
            inputMode="numeric"
            defaultValue={qty(defaults.unitsPerCase)}
            className="h-12 tabular-nums"
          />
        </Field>
        {/* The shop's own article number. This form once lacked it, so saving
            any product erased it — and with it the identifier a re-import
            matches most of a catalogue on, since most lines carry no barcode. */}
        <Field name="sku" label={t('sku')}>
          <Input id="sku" name="sku" autoComplete="off" defaultValue={defaults.sku ?? ''} className="h-12 font-mono" />
        </Field>
      </FieldPair>

      <Field name="categoryId" label={t('category')}>
        <NativeSelect id="categoryId" name="categoryId" defaultValue={defaults.categoryId ?? ''}>
          <option value="">{t('noCategory')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ${c.name}` : c.name}
            </option>
          ))}
        </NativeSelect>
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

      <Segmented
        name="unit"
        label={t('unit')}
        required
        defaultValue={defaults.unit ?? 'each'}
        options={UNITS.map((u) => ({ value: u, label: u }))}
      />

      <SwitchRow
        name="isWeighed"
        label={t('isWeighed')}
        hint={t('isWeighedHint')}
        defaultChecked={defaults.isWeighed ?? false}
      />

      <FieldPair>
        <Field name="costPrice" label={t('costPriceNet')}>
          <Input
            id="costPrice"
            name="costPrice"
            inputMode="decimal"
            defaultValue={defaults.costPrice ?? ''}
            className="h-12 tabular-nums"
          />
        </Field>
        {/* The shelf price, VAT included — the till extracts VAT from it. */}
        <Field name="sellPrice" label={t('sellPriceGross')}>
          <Input
            id="sellPrice"
            name="sellPrice"
            inputMode="decimal"
            defaultValue={defaults.sellPrice ?? ''}
            className="h-12 tabular-nums"
          />
        </Field>
      </FieldPair>

      {/* Most UK food is zero-rated; confectionery, crisps, soft drinks and hot
          food are not. A single aisle crosses both, so this cannot be inferred
          from the country and has to be set per product. The rate sits under
          each band so the choice is never made blind. */}
      <Segmented
        name="vatBand"
        label={t('vatBand')}
        required
        hint={t('vatBandHint')}
        defaultValue={bandDefault}
        options={bands.map((b) => ({
          value: b,
          label: (
            <>
              <span>{t(`vatBands.${b}`)}</span>
              {ratesByBand.has(b) && (
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {percent(ratesByBand.get(b)!)}
                </span>
              )}
            </>
          ),
        }))}
      />

      {/* Legally distinct in the UK: selling past use-by is a criminal
          offence, past best-before is routine and gets marked down. The till
          refuses a sale on the former; the dashboard flags both differently. */}
      <FieldPair>
        <Segmented
          name="dateType"
          label={t('dateType')}
          required
          defaultValue={defaults.dateType ?? 'use_by'}
          options={[
            { value: 'use_by', label: t('dateTypes.use_by') },
            { value: 'best_before', label: t('dateTypes.best_before') },
          ]}
        />
        <Field name="shelfLifeDays" label={t('shelfLife')}>
          <Input
            id="shelfLifeDays"
            name="shelfLifeDays"
            inputMode="numeric"
            defaultValue={defaults.shelfLifeDays ?? ''}
            className="h-12 tabular-nums"
          />
        </Field>
      </FieldPair>
      <p className="text-muted-foreground -mt-3 text-xs md:max-w-lg">{t('dateTypeHint')}</p>

      {/* Below the minimum, the product reads as low stock on the Products list
          and its supplier's page. A read, never an order. */}
      <FieldPair>
        <Field name="minStock" label={t('minStock')}>
          <Input
            id="minStock"
            name="minStock"
            inputMode="decimal"
            defaultValue={qty(defaults.minStock)}
            className="h-12 tabular-nums"
          />
        </Field>
        <Field name="maxStock" label={t('maxStock')}>
          <Input
            id="maxStock"
            name="maxStock"
            inputMode="decimal"
            defaultValue={qty(defaults.maxStock)}
            className="h-12 tabular-nums"
          />
        </Field>
      </FieldPair>

      {/* Where it sits, as staff would say it. Shown when someone scans it and
          on the expiry list, so it answers "where does this go back". */}
      <Field name="shelfLocation" label={t('shelfLocation')} hint={t('shelfLocationHint')}>
        <Input id="shelfLocation" name="shelfLocation" defaultValue={defaults.shelfLocation ?? ''} className="h-12" />
      </Field>

      {error === 'unknown' && (
        <p role="alert" className="text-destructive text-sm">
          {t('saveFailed')}
        </p>
      )}

      <StickyAction>
        <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
          {submitLabel}
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
    sku: value('sku'),
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
    dateType: (value('dateType') ?? 'use_by') as 'use_by' | 'best_before',
    supplierId: value('supplierId'),
    categoryId: value('categoryId'),
    shelfLifeDays: value('shelfLifeDays') ? Number(value('shelfLifeDays')) : null,
    shelfLocation: value('shelfLocation'),
    minStock: value('minStock'),
    maxStock: value('maxStock'),
  };
}
