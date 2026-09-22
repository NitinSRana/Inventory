// Every tenant has one location today, and the rule is to write as if they had
// ten. A join onto product_stock quietly breaks that: it gives a product one
// row per room it sits in, so lists repeat it and "below minimum" gets judged
// per room instead of per shop. These are the screens that read stock in bulk.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { locations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { deadStock, topProductsByStockValue, windowFor } from '@/server/analytics/trends';
import { createProduct, listProducts } from '@/server/catalog/products';
import { buildReport } from '@/server/reports';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { receiveStock } from '@/server/stock/movements';

describe('stock read across two locations', () => {
  let org: TestOrg;
  let split: string;
  let short: string;

  before(async () => {
    org = await createTestOrg('Two Rooms');
    const [backroom] = await withTenant(org.orgId, (tx) =>
      tx.insert(locations).values({ organizationId: org.orgId, name: 'Backroom', type: 'backroom' }).returning(),
    );

    // Five in the shop, five out the back: ten in total, above its minimum.
    split = (
      await createProduct(org.orgId, { name: 'Split Rice 1kg', costPrice: '2.00', sellPrice: '3.00', minStock: '8' })
    ).id;
    await receiveStock(org.orgId, { productId: split, quantity: '5' });
    await receiveStock(org.orgId, { productId: split, locationId: backroom.id, quantity: '5' });

    // Eight in total against a minimum of ten: genuinely short.
    short = (
      await createProduct(org.orgId, { name: 'Short Salt 500g', costPrice: '0.50', sellPrice: '1.00', minStock: '10' })
    ).id;
    await receiveStock(org.orgId, { productId: short, quantity: '4' });
    await receiveStock(org.orgId, { productId: short, locationId: backroom.id, quantity: '4' });
  });

  test('the stock report lists a product once, worth both rooms together', async () => {
    const report = await buildReport(org.orgId, 'stock', 30);
    const rows = report.rows.filter((r) => r.name === 'Split Rice 1kg');
    assert.equal(rows.length, 1, 'one row per product, not one per room');
    assert.equal(rows[0].quantity, '10.000');
    assert.equal(rows[0].value, '20.00');
  });

  test('low stock counts the whole shop, not each room', async () => {
    const report = await buildReport(org.orgId, 'low-stock', 30);
    const names = report.rows.map((r) => r.name);
    assert.equal(
      names.includes('Split Rice 1kg'),
      false,
      'ten against a minimum of eight is not short, though each room holds five',
    );
    assert.deepEqual(
      names.filter((n) => n === 'Short Salt 500g'),
      ['Short Salt 500g'],
      'and a genuinely short product is listed exactly once',
    );
  });

  test('dead stock and top-by-value each name a product once', async () => {
    const stuck = (await deadStock(org.orgId, windowFor(30), 8)).filter((p) => p.productId === split);
    assert.equal(stuck.length, 1);
    assert.equal(stuck[0].quantity, '10.000');
    assert.equal(stuck[0].value, '20.00');

    const ranked = (await topProductsByStockValue(org.orgId, 5)).filter((p) => p.label === 'Split Rice 1kg');
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].value, '30.00', 'ten units at the shelf price of three');
  });

  test('the products list reads the same total', async () => {
    const [row] = await listProducts(org.orgId, { search: 'Split Rice' });
    assert.equal(row.onHand, '10.000');
    assert.equal((await listProducts(org.orgId, { lowOrOut: true })).map((p) => p.id).includes(split), false);
    assert.ok((await listProducts(org.orgId, { lowOrOut: true })).map((p) => p.id).includes(short));
  });
});
