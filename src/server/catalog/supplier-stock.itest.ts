// "Which of the things this supplier brings are running out" — a read, and the
// ordering is the useful half of it, so both are worth holding still.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { locations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { createProduct } from '@/server/catalog/products';
import { createSupplier, getSupplierProducts, listSuppliers } from '@/server/catalog/suppliers';
import { receiveStock } from '@/server/stock/movements';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

describe('low stock by supplier', () => {
  let org: TestOrg;
  let bookers: string;

  before(async () => {
    org = await createTestOrg('Supplier Stock');
    bookers = (await createSupplier(org.orgId, { name: 'Bookers' })).id;

    // Under its minimum: two on the shelf, ten wanted.
    const running = await createProduct(org.orgId, {
      name: 'Zzz Last Alphabetically',
      supplierId: bookers,
      minStock: '10',
    });
    await receiveStock(org.orgId, { productId: running.id, quantity: '2' });

    // Fine: plenty on the shelf.
    const stocked = await createProduct(org.orgId, {
      name: 'Aaa First Alphabetically',
      supplierId: bookers,
      minStock: '5',
    });
    await receiveStock(org.orgId, { productId: stocked.id, quantity: '50' });

    // No minimum set, so it can never be "below" one — most of a catalogue
    // looks like this and none of it should read as a problem.
    await createProduct(org.orgId, { name: 'Bbb No Minimum', supplierId: bookers });
  });

  test('only a product with a minimum it is under is flagged', async () => {
    const rows = await getSupplierProducts(org.orgId, bookers);
    const flagged = rows.filter((r) => r.belowMinimum).map((r) => r.name);
    assert.deepEqual(flagged, ['Zzz Last Alphabetically']);
  });

  test('short products sort first, ahead of the alphabet', async () => {
    const rows = await getSupplierProducts(org.orgId, bookers);
    assert.equal(rows[0].name, 'Zzz Last Alphabetically', 'the reason to open the page comes first');
    assert.deepEqual(
      rows.slice(1).map((r) => r.name),
      ['Aaa First Alphabetically', 'Bbb No Minimum'],
      'and the rest stay alphabetical',
    );
  });

  test('a product stocked in two locations is one row, with both counted', async () => {
    const split = await createProduct(org.orgId, { name: 'Mmm Split Flour', supplierId: bookers, minStock: '8' });
    // Every tenant has one location today; the code is written for ten.
    const [backroom] = await withTenant(org.orgId, (tx) =>
      tx.insert(locations).values({ organizationId: org.orgId, name: 'Backroom', type: 'backroom' }).returning(),
    );
    await receiveStock(org.orgId, { productId: split.id, quantity: '5' });
    await receiveStock(org.orgId, { productId: split.id, locationId: backroom.id, quantity: '5' });

    const rows = (await getSupplierProducts(org.orgId, bookers)).filter((r) => r.id === split.id);
    assert.equal(rows.length, 1, 'not one row per location');
    assert.equal(rows[0].quantity, '10.000');
    assert.equal(rows[0].belowMinimum, false, '10 across both rooms is not under 8, though each room is');
  });

  test('last delivery is read off receipts, and is empty for a supplier nothing has come from', async () => {
    const quiet = await createSupplier(org.orgId, { name: 'Quiet Farm' });
    await createProduct(org.orgId, { name: 'Never Delivered Eggs', supplierId: quiet.id });

    const list = await listSuppliers(org.orgId);
    const booked = list.find((s) => s.id === bookers);
    assert.ok(booked?.lastDeliveryAt instanceof Date, 'Bookers has had stock received');
    assert.equal(list.find((s) => s.id === quiet.id)?.lastDeliveryAt, null);
  });

  test('another tenant sees none of it', async () => {
    const rival = await createTestOrg('Supplier Stock Rival');
    assert.deepEqual(await getSupplierProducts(rival.orgId, bookers), []);
    assert.deepEqual(await listSuppliers(rival.orgId, { includeInactive: true }), []);
  });
});
