// Historical-value reconstruction is exactly the class of query that looks
// right and silently isn't — an off-by-one on the cutoff, a sign error on the
// ledger sum. Worth real dated movements against a real database, not just a
// build check.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createCategory } from '@/server/catalog/categories';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { receiveStock } from '@/server/stock/movements';

import { averageMargin, categoryMix, inventoryValueSummary, productSummary } from './overview';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('inventory value summary', () => {
  test('30-days-ago value only counts movements at or before the cutoff', async () => {
    const org = await createTestOrg('Overview Value');
    const oldStock = (
      await createProduct(org.orgId, { name: 'Long-lived', gtin: '5000112637922', sellPrice: '2.0000' })
    ).id;
    const newStock = (
      await createProduct(org.orgId, { name: 'Just arrived', gtin: '5000112637939', sellPrice: '5.0000' })
    ).id;

    // Received 40 days ago: present in both "now" and "30 days ago" snapshots.
    await receiveStock(org.orgId, { productId: oldStock, quantity: '10', occurredAt: daysAgo(40) });
    // Received today: present now, but did not exist 30 days ago.
    await receiveStock(org.orgId, { productId: newStock, quantity: '10' });

    const summary = await inventoryValueSummary(org.orgId);
    // now: 10 x 2.00 + 10 x 5.00 = 70.00
    assert.equal(summary.current, '70.00');
    // 30 days ago: only the long-lived stock existed. 10 x 2.00 = 20.00.
    // (70 - 20) / 20 = 250%.
    assert.equal(summary.changePercent, '250.0');
  });

  test('nothing 30 days old reads as "no prior period", not a fabricated 0%', async () => {
    const org = await createTestOrg('Overview Fresh');
    const p = (await createProduct(org.orgId, { name: 'Brand new', sellPrice: '1.0000' })).id;
    await receiveStock(org.orgId, { productId: p, quantity: '5' });

    const summary = await inventoryValueSummary(org.orgId);
    assert.equal(summary.current, '5.00');
    assert.equal(summary.changePercent, null);
  });
});

describe('average margin', () => {
  test('a product with no cost price is excluded, not treated as zero', async () => {
    const org = await createTestOrg('Overview Margin');
    // Net 100, at 0% VAT: margin is exactly 50%.
    await createProduct(org.orgId, {
      name: 'Priced', gtin: '5000112637946', vatBand: 'zero', costPrice: '50.0000', sellPrice: '100.0000',
    });
    // No cost price at all — must not drag the average toward 0.
    await createProduct(org.orgId, {
      name: 'No cost yet', gtin: '5000112637953', vatBand: 'zero', sellPrice: '20.0000',
    });

    const margin = await averageMargin(org.orgId);
    assert.equal(margin.sampleSize, 1, 'only the fully-priced product counts');
    assert.equal(margin.percent, '50.0');
  });

  test('nothing priced yet is null, not zero', async () => {
    const org = await createTestOrg('Overview No Margin');
    await createProduct(org.orgId, { name: 'Unpriced', gtin: '5000112637960' });

    const margin = await averageMargin(org.orgId);
    assert.equal(margin.percent, null);
    assert.equal(margin.sampleSize, 0);
  });
});

describe('category mix', () => {
  test('categorized and uncategorized stock together sum to 100%', async () => {
    const org = await createTestOrg('Overview Mix');
    const drinks = await createCategory(org.orgId, { name: 'Beverages' });
    const drink = (
      await createProduct(org.orgId, { name: 'Cola', gtin: '5000112637977', categoryId: drinks.id })
    ).id;
    const loose = (await createProduct(org.orgId, { name: 'Loose screws', gtin: '5000112637984' })).id;

    await receiveStock(org.orgId, { productId: drink, quantity: '30' });
    await receiveStock(org.orgId, { productId: loose, quantity: '70' });

    const mix = await categoryMix(org.orgId, 'Uncategorized');
    const total = mix.reduce((sum, r) => sum + Number(r.value), 0);
    assert.ok(Math.abs(total - 100) < 0.2, `rows should sum to ~100%, got ${total}`);

    const beverages = mix.find((r) => r.label === 'Beverages');
    const uncategorized = mix.find((r) => r.label === 'Uncategorized');
    assert.equal(beverages?.value, '30.0');
    assert.equal(uncategorized?.value, '70.0');
  });
});

describe('product summary', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Overview Products');
    await createCategory(org.orgId, { name: 'A' });
    await createCategory(org.orgId, { name: 'B' });
    await createProduct(org.orgId, { name: 'One', gtin: '5000112637991' });
    await createProduct(org.orgId, { name: 'Two', gtin: '5000112638004' });
  });

  test('counts products, categories, and this month\'s additions together', async () => {
    const summary = await productSummary(org.orgId);
    assert.equal(summary.total, 2);
    assert.equal(summary.categories, 2);
    // Both products were just created, so both count as added this month.
    assert.equal(summary.addedThisMonth, 2);
  });
});
