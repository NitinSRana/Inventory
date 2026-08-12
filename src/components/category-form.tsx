import { getTranslations } from 'next-intl/server';

import { Field, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COUNT_FREQUENCIES } from '@/db/schema';

type Defaults = {
  name?: string;
  defaultCountFrequency?: string;
};

export async function CategoryForm({
  action,
  defaults = {},
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  defaults?: Defaults;
  error?: string;
}) {
  const t = await getTranslations('categories');

  return (
    <form action={action} className="flex flex-col gap-4 pb-20 sm:pb-0">
      <Field name="name" label={t('name')}>
        <Input id="name" name="name" required defaultValue={defaults.name} className="h-12" />
      </Field>

      <Field name="defaultCountFrequency" label={t('countFrequency')} hint={t('countFrequencyHint')}>
        <NativeSelect
          id="defaultCountFrequency"
          name="defaultCountFrequency"
          defaultValue={defaults.defaultCountFrequency ?? 'monthly'}
        >
          {COUNT_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t(`frequencies.${f}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>

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

/** Shared between create and edit so the two forms cannot drift apart. */
export function categoryInputFrom(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    defaultCountFrequency: String(
      formData.get('defaultCountFrequency') ?? 'monthly',
    ) as (typeof COUNT_FREQUENCIES)[number],
  };
}
