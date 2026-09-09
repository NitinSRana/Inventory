// "Which of the things this supplier brings are running out" — a read, and the
// ordering is the useful half of it, so both are worth holding still.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createSupplier, getSupplierProducts } from '@/server/catalog/suppliers';
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

  test('another tenant sees none of it', async () => {
    const rival = await createTestOrg('Supplier Stock Rival');
    assert.deepEqual(await getSupplierProducts(rival.orgId, bookers), []);
  });
});
