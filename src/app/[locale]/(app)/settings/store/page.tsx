import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Field, FieldPair, NativeSelect, StickyAction } from '@/components/form';
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

/**
 * Laid out as the "Store Settings" frame: name, country and currency side by
 * side, a timezone picker, then the contact details and VAT number.
 *
 * The timezone is a list now, not free text — the platform's own IANA names —
 * because a mistyped one used to save and then break every screen that asks
 * what "today" is. The server checks it again (updateOrganization).
 */
export default async function StoreSettingsPage({ params, searchParams }: PageProps<'/[locale]/settings/store'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { done, error } = await searchParams;
  const t = await getTranslations('store');
  const tBack = await getTranslations('back');
  // Country and currency touch every VAT rate and every money format in the
  // product. Owner only, same as VAT and team.
  const { orgId } = await requireRole(locale, 'owner');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  // A shop saved before this list existed may hold a name the list spells
  // differently; keep it selectable rather than silently replacing it.
  const zones = Intl.supportedValuesOf('timeZone');
  const timezones = zones.includes(org.timezone) ? zones : [org.timezone, ...zones];

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
    <main className="flex flex-1 flex-col gap-5 p-4 pb-28">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      <div className="flex items-center gap-3">
        <span className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-lg">
          <Settings aria-hidden className="size-5" />
        </span>
        <PageTitle caption={t('intro')}>{t('title')}</PageTitle>
      </div>

      {done && (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm md:max-w-lg">
          {t('saved')}
        </p>
      )}

      <form action={save} className="flex flex-col gap-5 pb-32 md:pb-0">
        <Field name="name" label={t('name')} required>
          <Input id="name" name="name" required defaultValue={org.name} className="h-12" />
        </Field>

        <FieldPair>
          <Field name="countryCode" label={t('country')} required>
            <NativeSelect id="countryCode" name="countryCode" defaultValue={org.countryCode} className="w-full">
              {SEEDED_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field name="currencyCode" label={t('currency')} required>
            <Input
              id="currencyCode"
              name="currencyCode"
              required
              maxLength={3}
              defaultValue={org.currencyCode}
              className="h-12 font-mono uppercase"
            />
          </Field>
        </FieldPair>
        <p className="text-muted-foreground -mt-3 text-xs md:max-w-lg">{t('countryHint')}</p>

        <Field name="timezone" label={t('timezone')} hint={t('timezoneHint')} required>
          <NativeSelect id="timezone" name="timezone" defaultValue={org.timezone} required className="w-full">
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field name="email" label={t('email')}>
          <Input id="email" name="email" type="email" defaultValue={org.email ?? ''} className="h-12" />
        </Field>

        <Field name="phone" label={t('phone')}>
          <Input id="phone" name="phone" type="tel" defaultValue={org.phone ?? ''} className="h-12" />
        </Field>

        <Field name="address" label={t('address')}>
          <Input id="address" name="address" defaultValue={org.address ?? ''} className="h-12" />
        </Field>

        <Field name="vatNumber" label={t('vatNumber')}>
          <Input id="vatNumber" name="vatNumber" defaultValue={org.vatNumber ?? ''} className="h-12 font-mono" />
        </Field>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {t('saveFailed')}
          </p>
        )}

        <StickyAction>
          <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
            {t('save')}
          </Button>
        </StickyAction>
      </form>
    </main>
  );
}
