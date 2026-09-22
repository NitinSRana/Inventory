import { getTranslations } from 'next-intl/server';

import { requestAccess } from '@/app/[locale]/request-access/actions';
import { Field, FieldPair, NativeSelect } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SEEDED_COUNTRIES } from '@/server/settings/vat-seeds';

/**
 * The access request form, on the landing page and on its own page.
 *
 * One component so the two cannot drift: the same fields, the same action, and
 * the same answer for every address. `back` is where the redirect lands — the
 * action validates it as a path on this site before using it.
 *
 * Country is a fixed list rather than free text because approval seeds that
 * shop's VAT rates from it; a country we have no rates for cannot be chosen.
 */
export async function RequestAccessForm({
  locale,
  back,
  requested,
  error,
}: {
  locale: string;
  back: string;
  requested: boolean;
  error?: string;
}) {
  const t = await getTranslations('requestAccess');

  if (requested) {
    return (
      <div className="bg-card flex flex-col gap-2 rounded-xl border p-4 md:max-w-lg">
        <p role="status" className="text-sm font-semibold">
          {t('sent')}
        </p>
        <p className="text-muted-foreground text-sm">{t('sentHint')}</p>
      </div>
    );
  }

  return (
    <form action={requestAccess} className="flex flex-col gap-4 md:max-w-lg">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={back} />

      <FieldPair>
        <Field name="contactName" label={t('nameLabel')} required>
          <Input id="contactName" name="contactName" autoComplete="name" required className="h-12" />
        </Field>
        <Field name="shopName" label={t('shopLabel')} required>
          <Input id="shopName" name="shopName" autoComplete="organization" required className="h-12" />
        </Field>
      </FieldPair>

      <Field name="email" label={t('emailLabel')} hint={t('emailHint')} required>
        <Input id="email" name="email" type="email" autoComplete="email" required className="h-12" />
      </Field>

      <Field name="countryCode" label={t('countryLabel')} hint={t('countryHint')} required>
        <NativeSelect id="countryCode" name="countryCode" defaultValue="GB" required className="w-full">
          {SEEDED_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error === 'throttled' ? t('throttled') : error === 'unavailable' ? t('unavailable') : t('error')}
        </p>
      )}

      <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
        {t('submit')}
      </Button>
    </form>
  );
}
