import { getTranslations } from 'next-intl/server';

import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UNITS } from '@/db/schema';

type Defaults = {
  name?: string;
  gtin?: string | null;
  caseGtin?: string | null;
  unitsPerCase?: string | null;
  unit?: string;
  costPrice?: string | null;
  sellPrice?: string | null;
  shelfLifeDays?: number | null;
  supplierId?: string | null;
  categoryId?: string | null;
};

export async function ProductForm({
  action,
  suppliers,
  categories,
  defaults = {},
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  defaults?: Defaults;
  error?: string;
}) {
  const t = await getTranslations('products');

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

      <FieldRow>
        <Field name="costPrice" label={t('cost')}>
          <Input
            id="costPrice"
            name="costPrice"
            inputMode="decimal"
            defaultValue={defaults.costPrice ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
        <Field name="sellPrice" label={t('price')}>
          <Input
            id="sellPrice"
            name="sellPrice"
            inputMode="decimal"
            defaultValue={defaults.sellPrice ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
      </FieldRow>

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
    unit: (value('unit') ?? 'each') as (typeof UNITS)[number],
    // Money stays a string all the way to the database.
    costPrice: value('costPrice'),
    sellPrice: value('sellPrice'),
    supplierId: value('supplierId'),
    categoryId: value('categoryId'),
    shelfLifeDays: value('shelfLifeDays') ? Number(value('shelfLifeDays')) : null,
  };
}
