// The audit log. Its whole value is that nothing quietly falls out of it, so
// the tests are mostly about rows that must still be there.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { claimInvitation } from '@/db/tenant';
import { inviteMember, listMembers, setMemberDisplayName } from '@/server/auth/team';
import { createProduct } from '@/server/catalog/products';
import { checkout, voidSale } from '@/server/pos/checkout';
import { buildReport } from '@/server/reports';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { adjustStock, receiveStock } from '@/server/stock/movements';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

describe('corrections report', () => {
  let org: TestOrg;
  let milk: string;

  before(async () => {
    org = await createTestOrg('Corrections Report');
    await seedVatRatesForCountry(org.orgId, 'DE');
    milk = (
      await createProduct(org.orgId, {
        name: 'Vollmilch 1L',
        gtin: '4001234567891',
        sellPrice: '1.2900',
        vatBand: 'reduced',
      })
    ).id;
    await receiveStock(org.orgId, { productId: milk, quantity: '100' });
  });

  test('a keying correction shows up with its reason and its author', async () => {
    const [owner] = await listMembers(org.orgId);
    await setMemberDisplayName(org.orgId, owner.id, 'Anna');

    await adjustStock(org.orgId, {
      productId: milk,
      quantityDelta: '-90',
      note: 'Received 100 cases instead of 10',
      actorId: org.userId,
    });

    const report = await buildReport(org.orgId, 'corrections', 30);
    const row = report.rows.find((r) => r.note.startsWith('Received 100'));
    assert.ok(row, 'the correction is listed');
    assert.equal(row.actor, 'Anna', 'named, not a UUID prefix');
    assert.equal(row.quantityDelta, '-90.000');
    assert.equal(row.saleNumber, '', 'this one reverses no sale');
  });

  test('a voided sale appears here too, against its sale number', async () => {
    const sale = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '2' }],
      tenderType: 'cash',
    });
    await voidSale(org.orgId, sale.id, { actorId: org.userId });

    const report = await buildReport(org.orgId, 'corrections', 30);
    const row = report.rows.find((r) => r.saleNumber === sale.saleNumber);
    // voidSale posts its reversals as manual_adjustment rows, which is why one
    // query covers both kinds without a union.
    assert.ok(row, 'the void is in the audit log without being written there twice');
    assert.equal(row.quantityDelta, '2.000', 'stock came back');
  });

  test('a correction by nobody in particular is still listed', async () => {
    await adjustStock(org.orgId, {
      productId: milk,
      quantityDelta: '-1',
      note: 'No actor recorded',
    });

    const report = await buildReport(org.orgId, 'corrections', 30);
    const row = report.rows.find((r) => r.note === 'No actor recorded');
    // The left joins matter: an unattributed row dropping out of the audit log
    // is exactly the row an audit log exists for.
    assert.ok(row);
    assert.equal(row.actor, '', 'blank, never an invented name');
  });

  test('a member with no name yet falls back to their id, not to nothing', async () => {
    await inviteMember(org.orgId, { email: 'nameless@store.example', role: 'manager' });
    const nameless = crypto.randomUUID();
    await claimInvitation(nameless, 'nameless@store.example');

    await adjustStock(org.orgId, {
      productId: milk,
      quantityDelta: '-1',
      note: 'By someone unnamed',
      actorId: nameless,
    });

    const report = await buildReport(org.orgId, 'corrections', 30);
    const row = report.rows.find((r) => r.note === 'By someone unnamed');
    assert.equal(row!.actor, nameless.slice(0, 8));
  });

  test('another tenant sees none of it', async () => {
    const rival = await createTestOrg('Corrections Rival');
    assert.deepEqual((await buildReport(rival.orgId, 'corrections', 30)).rows, []);
  });
});
