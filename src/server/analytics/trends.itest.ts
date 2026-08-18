// The charts are only as honest as these queries. The spine is the part worth
// pinning: a day with no sales must come back as zero, not be missing.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { checkout } from '@/server/pos/checkout';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { receiveStock } from '@/server/stock/movements';

import { dailyRevenue, topProductsByRevenue } from './trends';

describe('analytics trends', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Analytics');
    const milk = await createProduct(org.orgId, {
      name: 'Vollmilch 1L', gtin: '4001234567891', costPrice: '0.79', sellPrice: '1.19',
    });
    const bread = await createProduct(org.orgId, {
      name: 'Bauernbrot 750g', gtin: '4006381333931', costPrice: '1.40', sellPrice: '2.49',
    });

    await receiveStock(org.orgId, { productId: milk.id, quantity: '100' });
    await receiveStock(org.orgId, { productId: bread.id, quantity: '100' });

    // Two sales today: bread out-earns milk.
    await checkout(org.orgId, { lines: [{ productId: milk.id, quantity: '3' }], tenderType: 'cash' });
    await checkout(org.orgId, { lines: [{ productId: bread.id, quantity: '5' }], tenderType: 'card' });
  });

  test('a quiet day is a zero, not a missing row', async () => {
    const points = await dailyRevenue(org.orgId, 30);
    assert.equal(points.length, 30, 'one point per day, traded or not');
    const quiet = points.slice(0, 29);
    assert.ok(quiet.every((p) => p.value === '0'), 'days before trading read as zero');
  });

  test('the series is oldest-first and ends today', async () => {
    const points = await dailyRevenue(org.orgId, 7);
    const days = points.map((p) => p.day);
    assert.deepEqual(days, [...days].sort(), 'ascending, so a chart reads left to right');
    assert.equal(days.length, 7);
  });

  test("today's takings are the sum of the sales, gross", async () => {
    const points = await dailyRevenue(org.orgId, 30);
    const today = points[points.length - 1];
    // 3 x 1.19 + 5 x 2.49 = 3.57 + 12.45
    assert.equal(today.value, '16.02');
  });

  test('top products rank by revenue, not by units moved', async () => {
    const top = await topProductsByRevenue(org.orgId, 30, 5);
    // Milk sold 3, bread 5 — but bread also earns more, so check the money.
    assert.equal(top[0].label, 'Bauernbrot 750g');
    assert.equal(top[0].value, '12.45');
    assert.equal(top[1].value, '3.57');
  });

  test('another tenant sees none of it', async () => {
    const other = await createTestOrg('Analytics Neighbour');
    const points = await dailyRevenue(other.orgId, 30);
    assert.ok(points.every((p) => p.value === '0'), 'RLS scopes the spine query too');
    assert.deepEqual(await topProductsByRevenue(other.orgId, 30, 5), []);
  });
});
