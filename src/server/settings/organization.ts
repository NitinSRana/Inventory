import { eq } from 'drizzle-orm';

import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';

/**
 * Store details. Every field here has existed on `organizations` since the
 * first migration — country, currency and timezone are set once at signup and
 * nothing has ever let anyone correct them since.
 */
export type OrganizationInput = {
  name: string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  /** Optional contact/display details — no VAT or money logic reads these. */
  email?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  address?: string | null;
};

export async function updateOrganization(orgId: string, input: OrganizationInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Store name is required');

  // country_code/currency_code are char(2)/char(3) in Postgres, which pads a
  // short value with spaces rather than rejecting it — validated here so a
  // malformed value fails loudly instead of silently corrupting every VAT
  // lookup and money format keyed on these two columns.
  const countryCode = input.countryCode.trim().toUpperCase();
  if (countryCode.length !== 2) throw new Error('Country must be a 2-letter code');
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (currencyCode.length !== 3) throw new Error('Currency must be a 3-letter code');

  const timezone = input.timezone.trim();
  if (!timezone) throw new Error('Timezone is required');

  const [org] = await withTenant(orgId, (tx) =>
    tx
      .update(organizations)
      .set({
        name,
        countryCode,
        currencyCode,
        timezone,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        vatNumber: input.vatNumber?.trim() || null,
        address: input.address?.trim() || null,
      })
      .where(eq(organizations.id, orgId))
      .returning(),
  );
  return org ?? null;
}
