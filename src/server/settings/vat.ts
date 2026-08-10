import Decimal from 'decimal.js';
import { asc, desc, eq } from 'drizzle-orm';

import { VAT_BANDS, vatRates } from '@/db/schema';
import { withTenant } from '@/db/tenant';

import { COUNTRY_VAT_SEEDS, type VatBand } from './vat-seeds';

/**
 * VAT rates, per tenant.
 *
 * Rates are rows, never constants: CLAUDE.md forbids hardcoded country logic,
 * and a rate that changes by law would otherwise mean a deploy. Used for
 * valuation only — this is not a tax engine and does not produce invoices.
 */

/** The rate in force per band today, newest valid_from wins. */
export async function getVatRates(orgId: string) {
  const rows = await withTenant(orgId, (tx) =>
    tx.select().from(vatRates).orderBy(asc(vatRates.band), desc(vatRates.validFrom)),
  );

  // First row per band is the current one, given the ordering above.
  const current = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!current.has(row.band)) current.set(row.band, row);
  return [...current.values()];
}

/** Band → rate, with every known band present so callers need no fallback. */
export async function getRatesByBand(orgId: string): Promise<Record<VatBand, string>> {
  const rows = await getVatRates(orgId);
  const byBand = Object.fromEntries(VAT_BANDS.map((b) => [b, '0'])) as Record<VatBand, string>;
  for (const row of rows) byBand[row.band as VatBand] = row.rate;
  return byBand;
}

/**
 * Seeds the bands for a country, if nothing is set yet.
 *
 * Deliberately refuses to overwrite: a tenant that has adjusted a rate should
 * not have it silently reset by someone re-picking the country.
 */
export async function seedVatRatesForCountry(orgId: string, countryCode: string) {
  const seed = COUNTRY_VAT_SEEDS[countryCode.toUpperCase()];
  if (!seed) return { seeded: 0, reason: 'unknownCountry' as const };

  const existing = await getVatRates(orgId);
  if (existing.length > 0) return { seeded: 0, reason: 'alreadyConfigured' as const };

  await withTenant(orgId, (tx) =>
    tx.insert(vatRates).values(
      Object.entries(seed).map(([band, rate]) => ({
        organizationId: orgId,
        band: band as VatBand,
        rate,
        label: `${countryCode.toUpperCase()} ${band}`,
      })),
    ),
  );
  return { seeded: Object.keys(seed).length, reason: 'ok' as const };
}

/**
 * Records a new rate for a band rather than editing the old one — valid_from
 * keeps the history, so a valuation run last quarter can still be explained.
 */
export async function setVatRate(orgId: string, band: VatBand, ratePercent: string) {
  const rate = new Decimal(ratePercent.replace(',', '.')).dividedBy(100);
  if (rate.lessThan(0) || rate.greaterThan(1)) throw new Error('Rate must be between 0 and 100');

  return withTenant(orgId, async (tx) => {
    // One row per (org, band, valid_from); re-setting a rate the same day
    // replaces today's entry instead of colliding.
    await tx
      .insert(vatRates)
      .values({ organizationId: orgId, band, rate: rate.toFixed(4) })
      .onConflictDoUpdate({
        target: [vatRates.organizationId, vatRates.band, vatRates.validFrom],
        set: { rate: rate.toFixed(4) },
      });
  });
}

export async function clearVatRates(orgId: string) {
  return withTenant(orgId, (tx) => tx.delete(vatRates).where(eq(vatRates.organizationId, orgId)));
}
