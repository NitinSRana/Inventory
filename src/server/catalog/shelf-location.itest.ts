// Where a product sits in the shop (0016). It is free text, so what is worth
// proving is where it comes from and what is allowed to overwrite it.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { startCountSession } from '@/server/counting/sessions';
import { createTestOrg } from '@/server/testing/fixtures';

import { importProductsCsv } from './import';
import { getProduct, listProducts, updateProduct } from './products';

const idOf = async (orgId: string) => (await listProducts(orgId))[0].id;

describe('shelf location', () => {
  test('an import column called Shelf lands on the product', async () => {
    const org = await createTestOrg('Shelf Import');
    const result = await importProductsCsv(
      org.orgId,
      ['name,sku,shelf', 'Vollmilch 1L,VM1L,Fridge Row 2'].join('\n'),
    );

    // It used to be this importer's example of a column it ignored.
    assert.deepEqual(result.unknownColumns, []);
    const product = await getProduct(org.orgId, await idOf(org.orgId));
    assert.equal(product?.shelfLocation, 'Fridge Row 2');
  });

  test('a re-import with no shelf column keeps the shelf staff set in the app', async () => {
    const org = await createTestOrg('Shelf Kept');
    await importProductsCsv(org.orgId, ['name,sku,price', 'Butter 250g,BU250,2.49'].join('\n'));
    const id = await idOf(org.orgId);
    // The whole product, as the edit form posts it: updateProduct normalises
    // identifiers it is not given to null, so a partial update here would strip
    // the SKU and the re-import below would create a second product instead.
    await updateProduct(org.orgId, id, {
      name: 'Butter 250g',
      sku: 'BU250',
      sellPrice: '2.49',
      shelfLocation: 'Chiller shelf 3',
    });

    // A supplier's price file knows nothing about shelves. Silence is not an
    // instruction to clear what someone walked the shop to fill in.
    await importProductsCsv(org.orgId, ['name,sku,price', 'Butter 250g,BU250,2.59'].join('\n'));

    assert.equal((await listProducts(org.orgId)).length, 1, 'matched on its SKU, not duplicated');
    const product = await getProduct(org.orgId, id);
    assert.equal(product?.shelfLocation, 'Chiller shelf 3');
    assert.equal(product?.sellPrice, '2.5900', 'while the price the file did carry still landed');
  });

  test('a count can be scoped to one shelf', async () => {
    const org = await createTestOrg('Shelf Count');
    const session = await startCountSession(org.orgId, {
      name: 'Dairy & chilled',
      shelfLocation: 'Chiller shelf 3',
      startedBy: org.userId,
    });
    assert.equal(session.shelfLocation, 'Chiller shelf 3');
  });

  test('another shop cannot see a shelf through its own catalogue', async () => {
    const org = await createTestOrg('Shelf Owner');
    await importProductsCsv(org.orgId, ['name,sku,shelf', 'Brot 500g,BRD500,Aisle 1'].join('\n'));
    const rival = await createTestOrg('Shelf Rival');
    assert.equal(await getProduct(rival.orgId, await idOf(org.orgId)), null);
  });
});
