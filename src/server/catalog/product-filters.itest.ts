// The catalogue is the one list that reaches real size — 2,000 products in a
// pilot store — so what the filters include and exclude is worth proving.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import { createCategory } from './categories';
import { createProduct, deactivateProduct, listProducts, reactivateProduct } from './products';
import { createSupplier } from './suppliers';

describe('product filters', () => {
  let org: TestOrg;
  let chilled: string;
  let bookers: string;
  let complete: string;
  let noPrice: string;
  let retired: string;

  before(async () => {
    org = await createTestOrg('Product Filters');
    chilled = (await createCategory(org.orgId, { name: 'Chilled' })).id;
    const dry = (await createCategory(org.orgId, { name: 'Dry goods' })).id;
    bookers = (await createSupplier(org.orgId, { name: 'Bookers' })).id;
    const other = (await createSupplier(org.orgId, { name: 'Other' })).id;

    complete = (
      await createProduct(org.orgId, {
        name: 'Complete Yoghurt',
        gtin: '5012345678900',
        sellPrice: '1.2000',
        categoryId: chilled,
        supplierId: bookers,
      })
    ).id;

    // Missing a price: the till refuses to sell it, and nothing says so today.
    noPrice = (
      await createProduct(org.orgId, {
        name: 'Priceless Beans',
        gtin: '5012345678917',
        categoryId: dry,
        supplierId: other,
      })
    ).id;

    retired = (
      await createProduct(org.orgId, {
        name: 'Discontinued Crisps',
        gtin: '5012345678924',
        sellPrice: '0.8000',
        categoryId: dry,
        supplierId: other,
      })
    ).id;
    await deactivateProduct(org.orgId, retired);
  });

  test('category and supplier narrow the list', async () => {
    const byCategory = await listProducts(org.orgId, { categoryId: chilled });
    assert.deepEqual(byCategory.map((p) => p.id), [complete]);

    const bySupplier = await listProducts(org.orgId, { supplierId: bookers });
    assert.deepEqual(bySupplier.map((p) => p.id), [complete]);
  });

  test('needsAttention finds what the till or the shelf would trip over', async () => {
    const rows = await listProducts(org.orgId, { needsAttention: true });
    const ids = rows.map((p) => p.id);
    assert.ok(ids.includes(noPrice), 'a product with no price cannot be sold');
    assert.equal(ids.includes(complete), false, 'a fully-filled product is not a problem');
  });

  test('filters combine rather than replace one another', async () => {
    // Chilled *and* needing attention: the complete yoghurt is chilled but fine,
    // so the answer is nothing — not "everything chilled".
    const rows = await listProducts(org.orgId, { categoryId: chilled, needsAttention: true });
    assert.deepEqual(rows, []);
  });

  test('deactivated products are hidden by default and reachable on request', async () => {
    const active = await listProducts(org.orgId);
    assert.equal(active.some((p) => p.id === retired), false);

    const all = await listProducts(org.orgId, { includeInactive: true });
    assert.ok(all.some((p) => p.id === retired), 'there has to be a way to see them');
  });

  test('reactivating puts a product back in the ordinary list', async () => {
    await reactivateProduct(org.orgId, retired);
    const active = await listProducts(org.orgId);
    assert.ok(
      active.some((p) => p.id === retired),
      'until now the only way back was re-importing the barcode',
    );
    await deactivateProduct(org.orgId, retired);
  });

  test('another tenant sees none of it, however it is filtered', async () => {
    const rival = await createTestOrg('Filter Rival');
    assert.deepEqual(await listProducts(rival.orgId, { categoryId: chilled }), []);
    assert.deepEqual(await listProducts(rival.orgId, { needsAttention: true }), []);
    assert.deepEqual(await listProducts(rival.orgId, { includeInactive: true }), []);
  });
});
