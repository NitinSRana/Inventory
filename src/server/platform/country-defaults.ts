/**
 * What a new shop starts with, given the country its owner picked.
 *
 * A shop created in Britain with euros and Berlin time is wrong twice over, and
 * both are wrong in ways that are quiet: every price on every screen renders in
 * the wrong currency, and "today" on the dashboard and the till rolls over an
 * hour early. The owner can change both in Store settings, but they should
 * never have had to.
 *
 * Only the countries VAT rates exist for (vat-seeds.ts), because those are the
 * only ones the request form offers. Anything else falls back to the database
 * defaults, which is what happened before this existed.
 *
 * Pure, so it is checked without a database.
 */
export type CountryDefaults = { currencyCode: string; timezone: string };

const DEFAULTS: Record<string, CountryDefaults> = {
  GB: { currencyCode: 'GBP', timezone: 'Europe/London' },
  IE: { currencyCode: 'EUR', timezone: 'Europe/Dublin' },
  DE: { currencyCode: 'EUR', timezone: 'Europe/Berlin' },
  AT: { currencyCode: 'EUR', timezone: 'Europe/Vienna' },
  NL: { currencyCode: 'EUR', timezone: 'Europe/Amsterdam' },
  BE: { currencyCode: 'EUR', timezone: 'Europe/Brussels' },
  FR: { currencyCode: 'EUR', timezone: 'Europe/Paris' },
  ES: { currencyCode: 'EUR', timezone: 'Europe/Madrid' },
  IT: { currencyCode: 'EUR', timezone: 'Europe/Rome' },
  PT: { currencyCode: 'EUR', timezone: 'Europe/Lisbon' },
  PL: { currencyCode: 'PLN', timezone: 'Europe/Warsaw' },
};

/** Falls back to euros in Berlin — the columns' own defaults — for anywhere unlisted. */
export function defaultsForCountry(countryCode: string): CountryDefaults {
  return DEFAULTS[countryCode.trim().toUpperCase()] ?? { currencyCode: 'EUR', timezone: 'Europe/Berlin' };
}
