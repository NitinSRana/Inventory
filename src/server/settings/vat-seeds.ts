/**
 * Starting VAT rates per country. Pure data, no database import.
 *
 * These are seeds, not truth. They are written into the tenant's own vat_rates
 * rows on setup and edited from there — CLAUDE.md forbids hardcoded country
 * logic precisely so a rate change is a row update, not a deploy.
 *
 * Stored as decimal fractions to match numeric(5,4): 0.19 is 19%.
 */

export type VatBand = 'standard' | 'reduced' | 'super_reduced' | 'zero';

export const COUNTRY_VAT_SEEDS: Record<string, Partial<Record<VatBand, string>>> = {
  DE: { standard: '0.1900', reduced: '0.0700', zero: '0.0000' },
  AT: { standard: '0.2000', reduced: '0.1000', zero: '0.0000' },
  NL: { standard: '0.2100', reduced: '0.0900', zero: '0.0000' },
  BE: { standard: '0.2100', reduced: '0.0600', super_reduced: '0.0000', zero: '0.0000' },
  FR: { standard: '0.2000', reduced: '0.0550', super_reduced: '0.0210', zero: '0.0000' },
  ES: { standard: '0.2100', reduced: '0.1000', super_reduced: '0.0400', zero: '0.0000' },
  IT: { standard: '0.2200', reduced: '0.1000', super_reduced: '0.0400', zero: '0.0000' },
  PL: { standard: '0.2300', reduced: '0.0800', super_reduced: '0.0500', zero: '0.0000' },
  PT: { standard: '0.2300', reduced: '0.1300', super_reduced: '0.0600', zero: '0.0000' },
  IE: { standard: '0.2300', reduced: '0.1350', super_reduced: '0.0480', zero: '0.0000' },
};

export const SEEDED_COUNTRIES = Object.keys(COUNTRY_VAT_SEEDS);
