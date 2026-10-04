import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PageTitle } from '@/components/data-list';
import { Field, NativeSelect } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { one } from '@/lib/search-params';
import { requirePlatformAdmin } from '@/server/platform/admins';
import { provisionShop } from '@/server/platform/provision';
import { SEEDED_COUNTRIES } from '@/server/settings/vat-seeds';

// Reads the session, so it must never be prerendered or cached.
export const dynamic = 'force-dynamic';

/**
 * Creating a shop outright, without a request behind it.
 *
 * The queue is how a stranger gets in; this is how the platform owner onboards
 * someone they already decided about — a shop signed up over the phone, a
 * migration from the old system, their own second site. It goes through exactly
 * the same provisionShop() the approve button does, so the result is identical
 * and neither path can quietly diverge from the other.
 *
 * No request row is written. Nothing here is a decision about an application;
 * it is the decision itself, already made.
 */
export default async function AdminNewShopPage({ params, searchParams }: PageProps<'/[locale]/admin/new'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePlatformAdmin();

  const sp = await searchParams;
  const t = await getTranslations('admin');

  async function create(formData: FormData) {
    'use server';
    // Checked again here: a guard on the page is not a guard on the action.
    const admin = await requirePlatformAdmin();

    const shopName = String(formData.get('shopName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const countryCode = String(formData.get('countryCode') ?? '').trim().toUpperCase();

    // Same gate as the public form: a country whose VAT rates cannot be seeded
    // would leave the shop unable to price its first product correctly.
    const known = (SEEDED_COUNTRIES as readonly string[]).includes(countryCode);
    if (!shopName || !email.includes('@') || !known) {
      redirect(`/${locale}/admin/new?error=1`);
    }

    const h = await headers();
    const origin =
      h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? `http://${h.get('host') ?? 'localhost:3000'}`;

    const built = await provisionShop({
      orgId: crypto.randomUUID(),
      shopName,
      countryCode,
      ownerEmail: email,
      adminUserId: admin.userId,
      site: { origin, locale },
    });

    const ok = built.login !== 'failed' && built.login !== 'notConfigured' && built.mail === 'sent';
    redirect(
      `/${locale}/admin?created=${ok ? 'ok' : `${built.login}-${built.mail}`}` +
        `&shop=${encodeURIComponent(shopName)}&email=${encodeURIComponent(email)}`,
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <PageTitle caption={t('newShopIntro')}>{t('newShop')}</PageTitle>

      {one(sp.error) ? (
        <p role="alert" className="text-destructive text-sm">
          {t('newShopError')}
        </p>
      ) : null}

      <form action={create} className="flex max-w-lg flex-col gap-4">
        <Field name="shopName" label={t('newShopNameLabel')} required>
          <Input id="shopName" name="shopName" required autoComplete="off" className="h-12" />
        </Field>

        <Field name="email" label={t('newShopEmailLabel')} hint={t('newShopEmailHint')} required>
          <Input id="email" name="email" type="email" required autoComplete="off" className="h-12" />
        </Field>

        <Field name="countryCode" label={t('newShopCountryLabel')} hint={t('newShopCountryHint')} required>
          <NativeSelect id="countryCode" name="countryCode" required defaultValue="GB" className="h-12">
            {SEEDED_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Button type="submit" className="h-12">
          {t('newShopSubmit')}
        </Button>
      </form>
    </main>
  );
}
