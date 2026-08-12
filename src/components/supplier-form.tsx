import { getTranslations } from 'next-intl/server';

import { Field, FieldRow, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <form action={action} className="flex flex-col gap-4 pb-20 sm:pb-0">
      <Field name="name" label={t('name')}>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-12" />
      </Field>

      <Field name="contactName" label={t('contact')}>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={defaults.contactName ?? ''}
          className="h-12"
        />
      </Field>

      <Field name="email" label={t('email')}>
        {/* type=email gets the right phone keyboard and free format checking. */}
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          defaultValue={defaults.email ?? ''}
          className="h-12"
        />
      </Field>

      <Field name="phone" label={t('phone')}>
        <Input id="phone" name="phone" type="tel" defaultValue={defaults.phone ?? ''} className="h-12" />
      </Field>

      <FieldRow>
        {/* Lead time drives every reorder quantity, so say so where it's set. */}
        <Field name="leadTimeDays" label={t('leadTime')} hint={t('leadTimeHint')}>
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            inputMode="numeric"
            defaultValue={defaults.leadTimeDays ?? 3}
            className="h-12 text-right tabular-nums"
          />
        </Field>
        <Field name="minOrderValue" label={t('minOrder')}>
          <Input
            id="minOrderValue"
            name="minOrderValue"
            inputMode="decimal"
            defaultValue={defaults.minOrderValue ?? ''}
            className="h-12 text-right tabular-nums"
          />
        </Field>
      </FieldRow>

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

      <StickyAction>
        <Button type="submit" className="h-12 w-full sm:w-fit">
          {t('save')}
        </Button>
      </StickyAction>
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
