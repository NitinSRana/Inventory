import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UNITS } from '@/db/schema';

type Defaults = {
  name?: string;
  gtin?: string | null;
  unit?: string;
  costPrice?: string | null;
  sellPrice?: string | null;
  shelfLifeDays?: number | null;
  supplierId?: string | null;
};

export async function ProductForm({
  action,
  suppliers,
  defaults = {},
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  suppliers: { id: string; name: string }[];
  defaults?: Defaults;
  error?: string;
}) {
  const t = await getTranslations('products');
  const selectClass = 'border-input h-11 rounded-lg border bg-transparent px-3 text-sm';

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('name')}</Label>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="gtin">{t('barcode')}</Label>
        {/* inputMode numeric gives the phone keypad. Typing a barcode must stay
            possible when the camera fails or permission is refused. */}
        <Input
          id="gtin"
          name="gtin"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaults.gtin ?? ''}
          className="h-11 font-mono"
        />
        {error === 'barcode' && (
          <p role="alert" className="text-destructive text-sm">
            {t('invalidBarcode')}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="unit">{t('unit')}</Label>
        {/* Native select opens the OS picker on a phone, which beats any custom
            listbox one-handed. */}
        <select id="unit" name="unit" defaultValue={defaults.unit ?? 'each'} className={selectClass}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="costPrice">{t('cost')}</Label>
          <Input
            id="costPrice"
            name="costPrice"
            inputMode="decimal"
            defaultValue={defaults.costPrice ?? ''}
            className="h-11 text-right tabular-nums"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="sellPrice">{t('price')}</Label>
          <Input
            id="sellPrice"
            name="sellPrice"
            inputMode="decimal"
            defaultValue={defaults.sellPrice ?? ''}
            className="h-11 text-right tabular-nums"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="shelfLifeDays">{t('shelfLife')}</Label>
        <Input
          id="shelfLifeDays"
          name="shelfLifeDays"
          inputMode="numeric"
          defaultValue={defaults.shelfLifeDays ?? ''}
          className="h-11 text-right tabular-nums"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="supplierId">{t('supplier')}</Label>
        <select
          id="supplierId"
          name="supplierId"
          defaultValue={defaults.supplierId ?? ''}
          className={selectClass}
        >
          <option value="">{t('noSupplier')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {error === 'unknown' && (
        <p role="alert" className="text-destructive text-sm">
          {t('saveFailed')}
        </p>
      )}

      {/* Primary action in the bottom third, thumb-reachable. */}
      <Button type="submit" className="fixed inset-x-4 bottom-6 h-12 sm:static sm:w-fit">
        {t('save')}
      </Button>
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
    unit: (value('unit') ?? 'each') as (typeof UNITS)[number],
    // Money stays a string all the way to the database.
    costPrice: value('costPrice'),
    sellPrice: value('sellPrice'),
    supplierId: value('supplierId'),
    shelfLifeDays: value('shelfLifeDays') ? Number(value('shelfLifeDays')) : null,
  };
}
