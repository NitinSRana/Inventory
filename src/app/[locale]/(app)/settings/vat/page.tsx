import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/back-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VAT_BANDS, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { requireRole } from '@/server/auth/session';
import { SEEDED_COUNTRIES, type VatBand } from '@/server/settings/vat-seeds';
import { getRatesByBand, seedVatRatesForCountry, setVatRate } from '@/server/settings/vat';
import { PageTitle } from '@/components/data-list';

// Reads the session, so it must never be prerendered or cached: a cached page
// behind auth is a cross-tenant leak waiting to happen.
export const dynamic = 'force-dynamic';

export default async function VatSettingsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/settings/vat'>) {
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
    <main className="flex flex-1 flex-col gap-6 p-4 pb-28">
      <BackLink href={`/${locale}/more`} label={tBack('more')} />
      {/* The caption says what these are for, and what they are not for. */}
      <PageTitle caption={t('intro')}>{t('title')}</PageTitle>

      {seeded !== undefined && (
        <p role="status" className="text-sm">
          {t('saved')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      )}

      {!configured ? (
        <form action={seed} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="country">{t('countryLabel')}</Label>
            <select
              id="country"
              name="country"
              defaultValue={org.countryCode}
              className="border-input h-12 rounded-lg border bg-transparent px-3 text-sm"
            >
              {SEEDED_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{t('countryHint')}</p>
          </div>
          <Button type="submit" className="h-12 w-fit">
            {t('seed')}
          </Button>
        </form>
      ) : (
        <form action={save} className="flex flex-col gap-4">
          {VAT_BANDS.map((band) => (
            <div key={band} className="flex flex-col gap-2">
              <Label htmlFor={band}>{t(`bands.${band}`)}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={band}
                  name={band}
                  inputMode="decimal"
                  // Stored as a fraction, shown as a percentage — nobody thinks
                  // in 0.19.
                  defaultValue={(Number(rates[band as VatBand]) * 100).toFixed(2).replace(/\.00$/, '')}
                  className="h-12 w-28 text-right tabular-nums"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">{t('historyNote')}</p>
          <Button type="submit" className="fixed inset-x-4 bottom-20 sm:bottom-6 h-12 sm:static sm:w-fit">
            {t('save')}
          </Button>
        </form>
      )}
    </main>
  );
}
