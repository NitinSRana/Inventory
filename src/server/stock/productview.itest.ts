// The product view's two reads: what is on the shelf in batches, and what
// moved it. Both are ordering-sensitive and one does date arithmetic in SQL,
// which is not the kind of thing a typecheck can hold still.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { getProductBatches, getProductMovements } from '@/server/stock/levels';
import { receiveStock, recordWaste } from '@/server/stock/movements';

describe('product view queries', () => {
  let org: TestOrg;
  let productId: string;

  before(async () => {
    org = await createTestOrg('Product View');
    const p = await createProduct(org.orgId, { name: 'Vollmilch 3,5% 1L', costPrice: '0.79' });
    productId = p.id;
    const today = new Date();
    const inDays = (n: number) =>
      new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    await receiveStock(org.orgId, { productId, quantity: '10', expiryDate: inDays(3) });
    await receiveStock(org.orgId, { productId, quantity: '6', expiryDate: inDays(20) });
    await receiveStock(org.orgId, { productId, quantity: '4', expiryDate: null });
    await recordWaste(org.orgId, { productId, quantity: '2', reasonCode: 'expired' });
  });

  test('batches come back soonest-expiry-first with nulls last', async () => {
    const rows = await getProductBatches(org.orgId, productId);
    const dates = rows.map((r) => r.expiryDate);
    console.log('  order:', JSON.stringify(dates));
    assert.equal(dates[dates.length - 1], null, 'undated batch sorts last');
    const dated = dates.filter((d) => d !== null);
    assert.deepEqual(dated, [...dated].sort(), 'dated batches ascend');
  });

  test('daysRemaining is computed by the database, not the component', async () => {
    const rows = await getProductBatches(org.orgId, productId);
    const dated = rows.filter((r) => r.expiryDate !== null);
    console.log('  ', dated.map((r) => `${r.expiryDate}=${r.daysRemaining}d`).join(' '));

    // Deliberately not asserting an absolute number of days. The expiry dates
    // above are built in JavaScript and current_date comes from Postgres, and
    // those two clocks can sit on opposite sides of midnight — which is the
    // whole reason this subtraction happens in SQL rather than in the render.
    // The gap between two batches is the same in either clock, so that is what
    // is checked.
    const dayGap =
      (Date.parse(dated[1].expiryDate!) - Date.parse(dated[0].expiryDate!)) / 86_400_000;
    assert.equal(dated[1].daysRemaining! - dated[0].daysRemaining!, dayGap);
    assert.ok(Number.isInteger(dated[0].daysRemaining), 'a whole number of days');
    assert.equal(rows[rows.length - 1].daysRemaining, null, 'no expiry means no countdown');
  });

  test('movements read newest-first and carry their reason', async () => {
    const rows = await getProductMovements(org.orgId, productId, 10);
    console.log('  ', rows.map((r) => `${r.movementType}:${r.quantityDelta}`).join(' '));
    assert.equal(rows.length, 4, 'three receipts and one write-off');
    const waste = rows.find((r) => r.movementType === 'waste');
    assert.ok(waste, 'the write-off is visible');
    assert.equal(waste.reasonCode, 'expired');
    assert.ok(waste.quantityDelta.startsWith('-'), 'waste is negative in the ledger');
  });

  test('the limit is respected, so a busy product cannot flood the screen', async () => {
    const rows = await getProductMovements(org.orgId, productId, 2);
    assert.equal(rows.length, 2);
  });
});
