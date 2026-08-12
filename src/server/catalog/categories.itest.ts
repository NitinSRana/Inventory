import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct, getProduct } from '@/server/catalog/products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import {
  countProductsInCategory,
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from './categories';

describe('categories', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Categories Test');
  });

  test('created with a default count frequency', async () => {
    const c = await createCategory(org.orgId, { name: 'Dairy' });
    assert.equal(c.defaultCountFrequency, 'monthly');
  });

  test('a blank name is rejected', async () => {
    await assert.rejects(() => createCategory(org.orgId, { name: '   ' }));
  });

  test('list is sorted by name', async () => {
    await createCategory(org.orgId, { name: 'Zucchini' });
    await createCategory(org.orgId, { name: 'Apples' });
    const names = (await listCategories(org.orgId)).map((c) => c.name);
    assert.deepEqual(names, [...names].sort());
  });

  test('update changes the name and frequency', async () => {
    const c = await createCategory(org.orgId, { name: 'Bakery', defaultCountFrequency: 'weekly' });
    const updated = await updateCategory(org.orgId, c.id, { name: 'Fresh Bakery', defaultCountFrequency: 'monthly' });
    assert.equal(updated?.name, 'Fresh Bakery');
    assert.equal(updated?.defaultCountFrequency, 'monthly');
  });

  test('deleting a category leaves its products uncategorised, not orphaned', async () => {
    const c = await createCategory(org.orgId, { name: 'Frozen' });
    const p = await createProduct(org.orgId, { name: 'Frozen Peas', categoryId: c.id });

    assert.equal(await countProductsInCategory(org.orgId, c.id), 1);

    await deleteCategory(org.orgId, c.id);
    assert.equal(await getCategory(org.orgId, c.id), null);

    // products.category_id is `on delete set null` — the product must survive.
    const survived = await getProduct(org.orgId, p.id);
    assert.ok(survived, 'the product must not be deleted along with its category');
    assert.equal(survived!.categoryId, null);
  });

  test('another tenant sees none of it', async () => {
    const other = await createTestOrg('Categories Rival');
    const c = await createCategory(org.orgId, { name: 'Isolation Check' });

    assert.deepEqual(await listCategories(other.orgId), []);
    assert.equal(await getCategory(other.orgId, c.id), null);
  });
});
