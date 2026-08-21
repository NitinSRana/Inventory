import { getTranslations } from 'next-intl/server';

import { Field, FieldRow, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COUNT_FREQUENCIES } from '@/db/schema';

type Defaults = {
  name?: string;
  description?: string | null;
  icon?: string | null;
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

      <FieldRow>
        <Field name="icon" label={t('icon')} hint={t('iconHint')}>
          <Input
            id="icon"
            name="icon"
            maxLength={4}
            defaultValue={defaults.icon ?? ''}
            className="h-12 text-center text-lg"
          />
        </Field>
        <Field name="description" label={t('description')}>
          <Input
            id="description"
            name="description"
            defaultValue={defaults.description ?? ''}
            className="h-12"
          />
        </Field>
      </FieldRow>

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
  const value = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };

  return {
    name: String(formData.get('name') ?? ''),
    description: value('description'),
    icon: value('icon'),
    defaultCountFrequency: String(
      formData.get('defaultCountFrequency') ?? 'monthly',
    ) as (typeof COUNT_FREQUENCIES)[number],
  };
}
