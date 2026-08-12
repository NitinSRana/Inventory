import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import { getLivePosRates } from './posRate';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

async function postConsumption(orgId: string, locationId: string, productId: string, days: number[]) {
  for (const d of days) {
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reference_type, occurred_at)
      values (${orgId}, ${productId}, ${locationId}, '-1', 'consumption', 'sale', ${daysAgo(d)})`;
  }
}

describe('live POS consumption rate', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('POS Rate Test');
  });

  test('a product never sold has no entry, not a zero rate', async () => {
    const p = (await createProduct(org.orgId, { name: 'Never Sold' })).id;
    const rates = await getLivePosRates(org.orgId);
    assert.equal(rates.has(p), false, 'a confident zero would tell the shop to order nothing');
  });

  test('one or two sale-days is insufficient, so it is excluded entirely', async () => {
    const p = (await createProduct(org.orgId, { name: 'Barely Sold' })).id;
    await postConsumption(org.orgId, org.locationId, p, [5, 3]);
    const rates = await getLivePosRates(org.orgId);
    assert.equal(rates.has(p), false);
  });

  test('three sale-days is the floor for a low-confidence rate', async () => {
    const p = (await createProduct(org.orgId, { name: 'Three Days' })).id;
    await postConsumption(org.orgId, org.locationId, p, [5, 3, 1]);
    const rate = (await getLivePosRates(org.orgId)).get(p);
    assert.equal(rate?.confidence, 'low');
    assert.equal(rate?.saleDays, 3);
  });

  test('the rate is the trailing-window total divided by the window, not the sale-day count', async () => {
    const p = (await createProduct(org.orgId, { name: 'Uneven Days' })).id;
    // 2 + 1 + 1 = 4 units over 3 distinct days, 14-day window => 4/14.
    await postConsumption(org.orgId, org.locationId, p, [8, 8, 5]); // two sales same day = 1 day
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reference_type, occurred_at)
      values (${org.orgId}, ${p}, ${org.locationId}, '-1', 'consumption', 'sale', ${daysAgo(1)})`;
    const rate = (await getLivePosRates(org.orgId)).get(p);
    assert.equal(rate?.saleDays, 3, 'two sales on the same calendar day count as one sale-day');
    assert.equal(rate?.dailyRate, (4 / 14).toFixed(4));
  });

  test('a sale outside the trailing window does not count', async () => {
    const p = (await createProduct(org.orgId, { name: 'Old Sale' })).id;
    await postConsumption(org.orgId, org.locationId, p, [3, 2, 1]);
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reference_type, occurred_at)
      values (${org.orgId}, ${p}, ${org.locationId}, '-50', 'consumption', 'sale', ${daysAgo(30)})`;
    const rate = (await getLivePosRates(org.orgId)).get(p);
    assert.equal(rate?.saleDays, 3, 'a sale 30 days ago must not inflate a 14-day rate');
  });

  test('waste and receipts are not consumption', async () => {
    const p = (await createProduct(org.orgId, { name: 'Not A Sale' })).id;
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reason_code, occurred_at)
      values (${org.orgId}, ${p}, ${org.locationId}, '-5', 'waste', 'expired', ${daysAgo(1)})`;
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, occurred_at)
      values (${org.orgId}, ${p}, ${org.locationId}, '20', 'receipt', ${daysAgo(1)})`;
    const rates = await getLivePosRates(org.orgId);
    assert.equal(rates.has(p), false, 'only real sales are a consumption signal');
  });

  test('another tenant sees none of it', async () => {
    const p = (await createProduct(org.orgId, { name: 'Isolated' })).id;
    await postConsumption(org.orgId, org.locationId, p, [5, 3, 1]);

    const other = await createTestOrg('POS Rate Rival');
    const rates = await getLivePosRates(other.orgId);
    assert.equal(rates.has(p), false);
  });
});
