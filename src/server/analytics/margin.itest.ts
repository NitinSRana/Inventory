// Margin is the figure an owner acts on, and the only honest version uses what
// the units that left the shelf actually cost.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct, updateProduct } from '@/server/catalog/products';
import { checkout } from '@/server/pos/checkout';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { receiveStock } from '@/server/stock/movements';

import { deadStock, grossMargin, windowFor } from './trends';

describe('gross margin', () => {
  let org: TestOrg;
  let milk: string;

  before(async () => {
    org = await createTestOrg('Margin');
    const p = await createProduct(org.orgId, {
      name: 'Vollmilch 1L', gtin: '4001234567891', costPrice: '0.80', sellPrice: '2.00',
    });
    milk = p.id;
    // Bought cheap, at 0.50 — not the 0.80 on the product record.
    await receiveStock(org.orgId, { productId: milk, quantity: '10', unitCost: '0.50' });
  });

  test('cost comes from the batch that was sold, not the product record', async () => {
    await checkout(org.orgId, { lines: [{ productId: milk, quantity: '4' }], tenderType: 'cash' });

    const m = await grossMargin(org.orgId, windowFor(30));
    assert.equal(m.revenue, '8.00', '4 x 2.00');
    // 4 x 0.50 from the batch. Using products.cost_price would say 3.20.
    assert.equal(m.cogs, '2.00');
    assert.equal(m.margin, '6.00');
  });

  test("a later change to the product's cost does not rewrite past margin", async () => {
    const before = await grossMargin(org.orgId, windowFor(30));
    // The wholesaler puts the price up. History must not move.
    await updateProduct(org.orgId, milk, { name: 'Vollmilch 1L', costPrice: '1.50' });
    const after = await grossMargin(org.orgId, windowFor(30));
    assert.deepEqual(after, before, 'the batch cost is what was paid, and is settled');
  });

  test('a quiet period is zeroes, not nulls', async () => {
    // Two periods back: before this shop existed.
    const m = await grossMargin(org.orgId, windowFor(30, 2));
    assert.deepEqual(m, { revenue: '0', cogs: '0', margin: '0.00' });
  });

  test('the comparison window does not overlap the current one', async () => {
    const now = windowFor(30);
    const prev = windowFor(30, 1);
    assert.ok(prev.to <= now.from, 'previous period ends where the current one starts');
    assert.equal(
      Math.round((now.to.getTime() - now.from.getTime()) / 86_400_000),
      Math.round((prev.to.getTime() - prev.from.getTime()) / 86_400_000),
      'and is the same length, or the comparison is meaningless',
    );
  });
});

describe('dead stock', () => {
  test('lists what is on hand and unsold, worth most first, and excludes what sold', async () => {
    const org = await createTestOrg('Dead Stock');
    const slow = await createProduct(org.orgId, { name: 'Tinned artichoke', costPrice: '2.00' });
    const cheap = await createProduct(org.orgId, { name: 'Paper straws', costPrice: '0.10' });
    const moving = await createProduct(org.orgId, {
      name: 'Vollmilch 1L', costPrice: '0.80', sellPrice: '1.19',
    });

    await receiveStock(org.orgId, { productId: slow.id, quantity: '20' });   // 40.00
    await receiveStock(org.orgId, { productId: cheap.id, quantity: '50' });  // 5.00
    await receiveStock(org.orgId, { productId: moving.id, quantity: '30' });
    await checkout(org.orgId, { lines: [{ productId: moving.id, quantity: '1' }], tenderType: 'cash' });

    const rows = await deadStock(org.orgId, windowFor(30), 8);
    const names = rows.map((r) => r.label);
    assert.ok(!names.includes('Vollmilch 1L'), 'something that sold is not dead');
    assert.deepEqual(names, ['Tinned artichoke', 'Paper straws'], 'ranked by value, not quantity');
    assert.equal(rows[0].value, '40.00');
  });
});
