// Loose goods have no barcode, so the only way to reach them is by name. These
// cover the resolution the checkout screen depends on.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct, findProductByBarcode, listProducts } from './products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

describe('loose goods', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Weighed Goods');
    await createProduct(org.orgId, {
      name: 'Gouda jung am Stück',
      isWeighed: true,
      unit: 'kg',
      sellPrice: '12.90',
      costPrice: '8.40',
    });
    await createProduct(org.orgId, { name: 'Bananen', isWeighed: true, unit: 'kg', sellPrice: '1.99' });
    await createProduct(org.orgId, { name: 'Vollmilch 1L', gtin: '4001234567891', sellPrice: '1.19' });
  });

  test('a weighed product is stored as weighed, with no barcode', async () => {
    const [gouda] = await listProducts(org.orgId, { search: 'Gouda' });
    assert.equal(gouda.isWeighed, true);
    assert.equal(gouda.gtin, null, 'nothing to scan on a wedge of cheese');
    assert.equal(gouda.unit, 'kg');
  });

  test('it is findable by name, which is the only handle it has', async () => {
    const hits = await listProducts(org.orgId, { search: 'gouda' });
    assert.equal(hits.length, 1, 'and case-insensitively');
    assert.equal(hits[0].name, 'Gouda jung am Stück');
  });

  test('a partial name matches, since nobody types the whole thing at a till', async () => {
    const hits = await listProducts(org.orgId, { search: 'anan' });
    assert.ok(hits.some((h) => h.name === 'Bananen'));
  });

  test('barcode lookup still wins for something that has one', async () => {
    const found = await findProductByBarcode(org.orgId, '4001234567891');
    assert.equal(found?.name, 'Vollmilch 1L');
    assert.equal(found?.isWeighed, false);
  });

  test('a name typed into the barcode field resolves to nothing, so search takes over', async () => {
    // This is the branch the checkout screen keys on: not a barcode, so the
    // input was a name.
    assert.equal(await findProductByBarcode(org.orgId, 'Gouda'), null);
  });

  test('a weighed product takes a fractional quantity end to end', async () => {
    const { receiveStock } = await import('@/server/stock/movements');
    const { getProductStock } = await import('@/server/stock/levels');
    const [gouda] = await listProducts(org.orgId, { search: 'Gouda' });
    await receiveStock(org.orgId, { productId: gouda.id, quantity: '2.750' });
    const [stock] = await getProductStock(org.orgId, gouda.id);
    assert.equal(stock.quantity, '2.750', 'three decimals survive, as numeric(14,3) promises');
  });
});
