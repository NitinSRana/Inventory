import { eq } from 'drizzle-orm';

import { locations, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { inviteMember } from '@/server/auth/team';
import { seedVatRatesForCountry } from '@/server/settings/vat';

/**
 * Creates a shop, from approval.
 *
 * Until now this existed only in scripts (create-org.mjs, seed.mts), both of
 * which use the admin connection because creating the first organization looks
 * like the one write that cannot be tenant-scoped. It isn't: the org_isolation
 * policy on `organizations` checks `id = app.current_org_id()`, so a
 * transaction that sets the context to a fresh uuid may insert exactly that row
 * and nothing else. Shop creation therefore stays inside RLS rather than
 * reaching around it, and is testable by the ordinary integration harness.
 *
 * Every step is idempotent, because approving twice must converge on one shop:
 * the organization is inserted on conflict do nothing, the default location is
 * guarded by a select (a partial unique index forbids a second default), and
 * the owner invitation goes through inviteMember, which already handles being
 * called again for the same address.
 */
export type NewShop = {
  /** Supply one to make a retry rebuild the same shop rather than a second. */
  id: string;
  name: string;
  countryCode: string;
  ownerEmail: string;
  invitedBy?: string | null;
};

export type ShopCreated = {
  orgId: string;
  locationId: string;
  /** What VAT seeding concluded; `unknownCountry` means the owner must set rates by hand. */
  vat: 'ok' | 'unknownCountry' | 'alreadyConfigured';
};

export async function createShop(input: NewShop): Promise<ShopCreated> {
  const name = input.name.trim();
  if (!name) throw new Error('A shop name is required');
  const countryCode = input.countryCode.trim().toUpperCase();
  if (countryCode.length !== 2) throw new Error('Country must be a 2-letter code');

  const locationId = await withTenant(input.id, async (tx) => {
    await tx
      .insert(organizations)
      .values({ id: input.id, name, countryCode })
      .onConflictDoNothing({ target: organizations.id });

    // Select first rather than upsert: the default location has no natural key
    // to conflict on, and locations_one_default_per_org would reject a second.
    const [existing] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.isDefault, true))
      .limit(1);
    if (existing) return existing.id;

    const [created] = await tx
      .insert(locations)
      .values({ organizationId: input.id, name: 'Store', isDefault: true })
      .returning({ id: locations.id });
    return created.id;
  });

  // The invitation is what actually grants access: the applicant becomes an
  // owner when they first sign in, through app.claim_invitation.
  await inviteMember(input.id, { email: input.ownerEmail, role: 'owner', invitedBy: input.invitedBy });

  // Outside the transaction above: seedVatRatesForCountry opens its own, and it
  // already reports `alreadyConfigured` rather than duplicating rates.
  const seeded = await seedVatRatesForCountry(input.id, countryCode);

  return { orgId: input.id, locationId, vat: seeded.reason };
}
