import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** ISO weekdays: 1 = Monday .. 7 = Sunday, matching suppliers.delivery_weekdays. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

type Defaults = {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  leadTimeDays?: number;
  minOrderValue?: string | null;
  deliveryWeekdays?: number[];
};

export async function SupplierForm({
  action,
  defaults = {},
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  defaults?: Defaults;
  error?: string;
}) {
  const t = await getTranslations('suppliers');
  const selected = new Set(defaults.deliveryWeekdays ?? []);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('name')}</Label>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="contactName">{t('contact')}</Label>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={defaults.contactName ?? ''}
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        {/* type=email gets the right phone keyboard and free format checking. */}
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          defaultValue={defaults.email ?? ''}
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t('phone')}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={defaults.phone ?? ''}
          className="h-11"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="leadTimeDays">{t('leadTime')}</Label>
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            inputMode="numeric"
            defaultValue={defaults.leadTimeDays ?? 3}
            className="h-11 text-right tabular-nums"
          />
          {/* Lead time drives every reorder quantity, so say so where it's set. */}
          <p className="text-muted-foreground text-xs">{t('leadTimeHint')}</p>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="minOrderValue">{t('minOrder')}</Label>
          <Input
            id="minOrderValue"
            name="minOrderValue"
            inputMode="decimal"
            defaultValue={defaults.minOrderValue ?? ''}
            className="h-11 text-right tabular-nums"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t('deliveryDays')}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            // Native checkbox in a 44px label: the whole chip is the target, so
            // it works with a gloved thumb.
            <label
              key={d}
              className="border-input flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm"
            >
              <input
                type="checkbox"
                name="deliveryWeekdays"
                value={d}
                defaultChecked={selected.has(d)}
                className="size-4"
              />
              {t(`weekdays.${d}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t('saveFailed')}
        </p>
      )}

      <Button type="submit" className="h-11 w-fit">
        {t('save')}
      </Button>
    </form>
  );
}

/** Shared between create and edit so the two cannot drift apart. */
export function supplierInputFrom(formData: FormData) {
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  return {
    name: String(formData.get('name') ?? ''),
    contactName: value('contactName'),
    email: value('email'),
    phone: value('phone'),
    leadTimeDays: Number(value('leadTimeDays') ?? 3) || 3,
    // Money stays a string all the way to the database.
    minOrderValue: value('minOrderValue'),
    deliveryWeekdays: formData.getAll('deliveryWeekdays').map(Number).filter(Number.isInteger),
  };
}
