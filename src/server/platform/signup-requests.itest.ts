// Approval is the one path that creates a tenant, and it is driven by a button
// someone can click twice. What it must never do is build a second shop.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { locations, organizationInvitations, organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getRatesByBand } from '@/server/settings/vat';
import { adminSql } from '@/server/testing/fixtures';

import { approveRequest, declineRequest, listRequests, submitRequest } from './signup-requests';

const admin = crypto.randomUUID();

async function requestFor(email: string, shopName: string, countryCode = 'DE') {
  await submitRequest({ email, contactName: 'Anna Müller', shopName, countryCode });
  const [row] = (await listRequests()).filter((r) => r.email === email);
  return row;
}

describe('access requests', () => {
  test('a submitted request waits, and submitting again does not queue a second', async () => {
    const email = `twice-${crypto.randomUUID()}@example.com`;
    const first = await requestFor(email, 'Twice Grocer');
    assert.equal(first.status, 'pending');
    assert.equal(first.shopName, 'Twice Grocer');

    await submitRequest({ email, contactName: 'Someone Else', shopName: 'Different Name', countryCode: 'GB' });
    const rows = (await listRequests('pending')).filter((r) => r.email === email);
    assert.equal(rows.length, 1, 'one pending row per address');
    assert.equal(rows[0].shopName, 'Twice Grocer', 'the first submission is the one that stands');
  });

  test('approving builds the shop: organization, default location, owner invitation, VAT rates', async () => {
    const email = `approve-${crypto.randomUUID()}@example.com`;
    const request = await requestFor(email, 'Approved Grocer', 'DE');

    const result = await approveRequest(request.id, admin, 'https://example.com/en/sign-in?mode=link');
    assert.equal(result.outcome, 'approved');
    if (result.outcome !== 'approved') return;

    const shop = await withTenant(result.orgId, async (tx) => ({
      orgs: await tx.select().from(organizations),
      locations: await tx.select().from(locations),
      invitations: await tx.select().from(organizationInvitations),
    }));
    assert.equal(shop.orgs.length, 1);
    assert.equal(shop.orgs[0].name, 'Approved Grocer');
    assert.equal(shop.orgs[0].countryCode, 'DE');
    assert.equal(shop.locations.length, 1);
    assert.equal(shop.locations[0].isDefault, true);
    assert.equal(shop.invitations.length, 1);
    assert.equal(shop.invitations[0].email, email);
    assert.equal(shop.invitations[0].role, 'owner', 'they own the shop they asked for');
    assert.equal(shop.invitations[0].acceptedAt, null, 'claimed on their first sign-in, not before');

    // A shop that cannot price its first product correctly is not set up.
    const rates = await getRatesByBand(result.orgId);
    assert.ok(Object.keys(rates).length > 0, 'German VAT rates were seeded');

    const [stored] = (await listRequests()).filter((r) => r.id === request.id);
    assert.equal(stored.status, 'approved');
    assert.equal(stored.organizationId, result.orgId);
  });

  test('approving twice converges on the same shop rather than building a second', async () => {
    const email = `double-${crypto.randomUUID()}@example.com`;
    const request = await requestFor(email, 'Double Grocer');

    const first = await approveRequest(request.id, admin, 'https://example.com/en/sign-in');
    const second = await approveRequest(request.id, admin, 'https://example.com/en/sign-in');
    assert.equal(first.outcome, 'approved');
    assert.equal(second.outcome, 'approved');
    if (first.outcome !== 'approved' || second.outcome !== 'approved') return;
    assert.equal(second.orgId, first.orgId, 'the second click adopts the shop the first one made');

    const shop = await withTenant(first.orgId, async (tx) => ({
      orgs: await tx.select().from(organizations),
      locations: await tx.select().from(locations),
      invitations: await tx.select().from(organizationInvitations),
    }));
    assert.equal(shop.orgs.length, 1);
    assert.equal(shop.locations.length, 1, 'no second default location');
    assert.equal(shop.invitations.length, 1, 'no duplicate invitation');

    const named = await adminSql`select count(*)::int as n from organizations where name = 'Double Grocer'`;
    assert.equal(named[0].n, 1, 'and no twin shop anywhere in the database');
  });

  test('declining decides the request and creates nothing', async () => {
    const email = `decline-${crypto.randomUUID()}@example.com`;
    const request = await requestFor(email, 'Declined Grocer');

    const result = await declineRequest(request.id, admin);
    assert.equal(result.declined, true);

    const [stored] = (await listRequests()).filter((r) => r.id === request.id);
    assert.equal(stored.status, 'declined');
    assert.equal(stored.organizationId, null);

    const named = await adminSql`select count(*)::int as n from organizations where name = 'Declined Grocer'`;
    assert.equal(named[0].n, 0);

    // And a declined request cannot be approved by a later click.
    const after = await approveRequest(request.id, admin, 'https://example.com/en/sign-in');
    assert.equal(after.outcome, 'notPending');
  });
});
