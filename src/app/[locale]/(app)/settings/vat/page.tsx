import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';

import { BackLink } from '@/components/back-link';
import { PageTitle } from '@/components/data-list';
import { Field, NativeSelect, StickyAction } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VAT_BANDS, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import { SEEDED_COUNTRIES, type VatBand } from '@/server/settings/vat-seeds';
import { getRatesByBand, seedVatRatesForCountry, setVatRate } from '@/server/settings/vat';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

/**
 * Laid out as the "VAT Rates Configuration" frame: one card, a row per band
 * with its name, its band code, and the rate as a percentage on the right.
 *
 * The frame's amber "Compliance Check" quote is not reproduced: it is a claim
 * about the database rather than guidance for the person setting a rate. The
 * note that is shown says what actually happens when a rate changes.
 */
export default async function VatSettingsPage({ params, searchParams }: PageProps<'/[locale]/settings/vat'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { seeded, error } = await searchParams;
  const t = await getTranslations('vat');
  const tBack = await getTranslations('back');
  // Rates affect every valuation in the product. Owner only.
  const { orgId } = await requireRole(locale, 'owner');

  const [org] = await withTenant(orgId, (tx) => tx.select().from(organizations));
  const rates = await getRatesByBand(orgId);
  const configured = Object.values(rates).some((r) => Number(r) > 0);

  async function seed(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    const country = String(formData.get('country') ?? '');
    const result = await seedVatRatesForCountry(orgId, country);
    redirect(
      result.reason === 'ok'
        ? `/${locale}/settings/vat?seeded=${result.seeded}`
        : `/${locale}/settings/vat?error=${result.reason}`,
    );
  }

  async function save(formData: FormData) {
    'use server';
    const { orgId } = await requireRole(locale, 'owner');
    try {
      for (const band of VAT_BANDS) {
        const value = String(formData.get(band) ?? '').trim();
        if (value) await setVatRate(orgId, band as VatBand, value);
      }
    } catch {
      redirect(`/${locale}/settings/vat?error=invalidRate`);
    }
    redirect(`/${locale}/settings/vat?seeded=0`);
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 pb-28 md:max-w-xl">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      {/* The caption says what these are for, and what they are not for. */}
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {seeded !== undefined && (
        <p role="status" className="bg-card rounded-lg border p-3 text-sm">
          {t('saved')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      )}

      {!configured ? (
        <form action={seed} className="bg-card flex flex-col gap-4 rounded-xl border p-4">
          <Field name="country" label={t('countryLabel')} hint={t('countryHint')}>
            <NativeSelect id="country" name="country" defaultValue={org.countryCode}>
              {SEEDED_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
            {t('seed')}
          </Button>
        </form>
      ) : (
        <form action={save} className="flex flex-col gap-4">
          <ul className="bg-card divide-border divide-y overflow-hidden rounded-xl border">
            {VAT_BANDS.map((band) => (
              <li key={band} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <label htmlFor={band} className="text-base font-semibold">
                    {t(`bands.${band}`)}
                  </label>
                  <span className="bg-muted text-muted-foreground rounded border px-1.5 font-mono text-xs uppercase">
                    <span className="sr-only">{t('bandCode')} </span>
                    {band}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    id={band}
                    name={band}
                    inputMode="decimal"
                    // Stored as a fraction, shown as a percentage — nobody thinks
                    // in 0.19. Blank, not "0", when the band was never set: a
                    // zero here is what convinces someone VAT is configured when
                    // it is not.
                    defaultValue={
                      rates[band as VatBand] === undefined
                        ? ''
                        : (Number(rates[band as VatBand]) * 100).toFixed(2).replace(/\.00$/, '')
                    }
                    placeholder={t('notSet')}
                    className="h-11 w-24 text-right font-semibold tabular-nums"
                  />
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              </li>
            ))}
          </ul>

          <p className="bg-muted flex items-start gap-2 rounded-lg border p-3 text-sm">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('historyNote')}
          </p>

          <StickyAction>
            <Button type="submit" className="h-12 w-full sm:w-fit sm:px-8">
              {t('save')}
            </Button>
          </StickyAction>
        </form>
      )}
    </main>
  );
}
