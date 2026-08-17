// Receiving in cases multiplies a figure into an append-only ledger, where the
// only correction is a compensating movement. Worth pinning.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import Decimal from 'decimal.js';

import { createProduct, getProduct } from '@/server/catalog/products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { getProductStock } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';

/** What the receive action does once it has resolved the case size itself. */
async function receiveInCases(orgId: string, productId: string, cases: string) {
  const fresh = await getProduct(orgId, productId);
  const quantity = fresh?.unitsPerCase
    ? new Decimal(cases).times(fresh.unitsPerCase).toString()
    : cases;
  await receiveStock(orgId, { productId, quantity });
  return quantity;
}

describe('receiving by the case', () => {
  let org: TestOrg;
  let cased: string;
  let loose: string;

  before(async () => {
    org = await createTestOrg('Case Receipt');
    const a = await createProduct(org.orgId, {
      name: 'Yeos Black Soy Drink 12x1ltr',
      gtin: '9556156046955',
      caseGtin: '8888001789597',
      unitsPerCase: '12',
    });
    cased = a.id;
    const b = await createProduct(org.orgId, { name: 'Loose apples', unit: 'kg' });
    loose = b.id;
  });

  test('five cases of twelve lands as sixty units', async () => {
    const posted = await receiveInCases(org.orgId, cased, '5');
    assert.equal(posted, '60');
    const [stock] = await getProductStock(org.orgId, cased);
    assert.equal(stock.quantity, '60.000');
  });

  test('a fractional case size does not drift', async () => {
    // 6 trays of 0.5 kg tubs — the reason this is Decimal and not a float.
    const p = await createProduct(org.orgId, {
      name: 'Yoghurt tub 500g', unit: 'kg', unitsPerCase: '0.5',
    });
    const posted = await receiveInCases(org.orgId, p.id, '6');
    assert.equal(posted, '3');
    const [stock] = await getProductStock(org.orgId, p.id);
    assert.equal(stock.quantity, '3.000');
  });

  test('a product with no case size receives exactly what was typed', async () => {
    const posted = await receiveInCases(org.orgId, loose, '2.5');
    assert.equal(posted, '2.5');
    const [stock] = await getProductStock(org.orgId, loose);
    assert.equal(stock.quantity, '2.500');
  });

  test('the case size comes from the database, so a forged form cannot inflate it', async () => {
    // The page posts entryUnit only; the multiplier is looked up. Even if a
    // caller claims a case of 1000, the stored 12 is what gets applied.
    const fresh = await getProduct(org.orgId, cased);
    assert.equal(fresh?.unitsPerCase, '12.000');

    // product_stock sums the ledger, so quantity is nullable for a product
    // nothing has ever moved. This one has, but the type says otherwise and
    // Decimal will not take null.
    const before = (await getProductStock(org.orgId, cased))[0].quantity ?? '0';
    await receiveInCases(org.orgId, cased, '1');
    const after = (await getProductStock(org.orgId, cased))[0].quantity ?? '0';
    assert.equal(
      new Decimal(after).minus(before).toString(),
      '12',
      'one case adds the stored case size, whatever a form might say',
    );
  });
});
