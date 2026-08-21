import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Field, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import { SEEDED_COUNTRIES } from '@/server/settings/vat-seeds';
import { updateOrganization } from '@/server/settings/organization';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function StoreSettingsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/settings/store'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { done, error } = await searchParams;
  const t = await getTranslations('store');
  const tBack = await getTranslations('back');
  // Country and currency touch every VAT rate and every money format in the
  // product. Owner only, same as VAT and team.
  const { orgId } = await requireRole(locale, 'owner');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    try {
      const value = (key: string) => {
        const v = formData.get(key);
        return typeof v === 'string' && v.trim() ? v.trim() : null;
      };
      await updateOrganization(orgId, {
        name: String(formData.get('name') ?? ''),
        countryCode: String(formData.get('countryCode') ?? ''),
        currencyCode: String(formData.get('currencyCode') ?? ''),
        timezone: String(formData.get('timezone') ?? ''),
        email: value('email'),
        phone: value('phone'),
        vatNumber: value('vatNumber'),
        address: value('address'),
      });
    } catch {
      redirect(`/${locale}/settings/store?error=1`);
    }
    redirect(`/${locale}/settings/store?done=1`);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {done && (
        <p role="status" className="text-sm">
          {t('saved')}
        </p>
      )}

      <form action={save} className="flex flex-col gap-4 pb-20 sm:pb-0">
        <Field name="name" label={t('name')}>
          <Input id="name" name="name" required defaultValue={org.name} className="h-12" />
        </Field>

        <Field name="countryCode" label={t('country')} hint={t('countryHint')}>
          <NativeSelect id="countryCode" name="countryCode" defaultValue={org.countryCode}>
            {SEEDED_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field name="currencyCode" label={t('currency')}>
          <Input
            id="currencyCode"
            name="currencyCode"
            required
            maxLength={3}
            defaultValue={org.currencyCode}
            className="h-12 font-mono uppercase"
          />
        </Field>

        <Field name="timezone" label={t('timezone')} hint={t('timezoneHint')}>
          <Input id="timezone" name="timezone" required defaultValue={org.timezone} className="h-12" />
        </Field>

        <Field name="email" label={t('email')}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={org.email ?? ''}
            className="h-12"
          />
        </Field>

        <Field name="phone" label={t('phone')}>
          <Input id="phone" name="phone" type="tel" defaultValue={org.phone ?? ''} className="h-12" />
        </Field>

        <Field name="vatNumber" label={t('vatNumber')}>
          <Input
            id="vatNumber"
            name="vatNumber"
            defaultValue={org.vatNumber ?? ''}
            className="h-12 font-mono"
          />
        </Field>

        <Field name="address" label={t('address')}>
          <Input id="address" name="address" defaultValue={org.address ?? ''} className="h-12" />
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
    </main>
  );
}
