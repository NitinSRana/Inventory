import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import { updateOrganization } from './organization';

describe('store settings', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Original Name');
  });

  test('updates name, country, currency and timezone', async () => {
    const updated = await updateOrganization(org.orgId, {
      name: 'Renamed Grocer',
      countryCode: 'nl',
      currencyCode: 'eur',
      timezone: 'Europe/Amsterdam',
    });
    assert.equal(updated?.name, 'Renamed Grocer');
    // Uppercased regardless of what was typed — a lowercase code would silently
    // fail every join keyed on it.
    assert.equal(updated?.countryCode, 'NL');
    assert.equal(updated?.currencyCode, 'EUR');
    assert.equal(updated?.timezone, 'Europe/Amsterdam');
  });

  test('a blank name is rejected', async () => {
    await assert.rejects(() =>
      updateOrganization(org.orgId, { name: '   ', countryCode: 'DE', currencyCode: 'EUR', timezone: 'Europe/Berlin' }),
    );
  });

  test('a malformed country code is rejected, not silently padded', async () => {
    // char(2) in Postgres pads a short value with a space rather than
    // rejecting it; the length check exists because the database will not.
    await assert.rejects(() =>
      updateOrganization(org.orgId, { name: 'X', countryCode: 'GER', currencyCode: 'EUR', timezone: 'Europe/Berlin' }),
    );
    await assert.rejects(() =>
      updateOrganization(org.orgId, { name: 'X', countryCode: 'G', currencyCode: 'EUR', timezone: 'Europe/Berlin' }),
    );
  });

  test('a malformed currency code is rejected', async () => {
    await assert.rejects(() =>
      updateOrganization(org.orgId, { name: 'X', countryCode: 'DE', currencyCode: 'EURO', timezone: 'Europe/Berlin' }),
    );
  });

  test("updating one tenant's store never touches another's", async () => {
    // updateOrganization takes only orgId, never a separate target id, so
    // there is no attacker-controlled id to smuggle a cross-tenant write
    // through — RLS scopes `organizations` to id = current_org_id(), same as
    // everything else, and this just confirms that holds here too.
    const other = await createTestOrg('Rival Grocer');
    await updateOrganization(other.orgId, {
      name: 'Rival Renamed',
      countryCode: 'FR',
      currencyCode: 'EUR',
      timezone: 'Europe/Paris',
    });

    const untouched = await updateOrganization(org.orgId, {
      name: 'Still Mine',
      countryCode: 'DE',
      currencyCode: 'EUR',
      timezone: 'Europe/Berlin',
    });
    assert.equal(untouched?.name, 'Still Mine');
    assert.equal(untouched?.countryCode, 'DE', "the rival's FR must not have leaked across");
  });
});
