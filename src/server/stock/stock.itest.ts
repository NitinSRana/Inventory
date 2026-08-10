import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { InsufficientStockError } from '@/server/stock/fefo';
import { getBatchStock, getExpiringStock, getProductStock } from '@/server/stock/levels';
import { adjustStock, receiveStock, recordWaste } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

/**
 * The ledger against a real database. These cover what unit tests cannot: the
 * append-only trigger, FEFO across real batch rows, and the fact that quantity
 * is derived by a view rather than stored.
 */
describe('stock ledger', () => {
  let org: TestOrg;
  let productId: string;

  before(async () => {
    org = await createTestOrg('Stock Ledger Test');
    const product = await createProduct(org.orgId, {
      name: 'Vollmilch 1L',
      gtin: '4001234567891',
      costPrice: '0.8000',
    });
    productId = product.id;
  });


  test('receipts accumulate and quantity is derived, never stored', async () => {
    await receiveStock(org.orgId, { productId, quantity: '10', expiryDate: '2026-09-30' });
    await receiveStock(org.orgId, { productId, quantity: '6', expiryDate: '2026-08-20' });

    const [stock] = await getProductStock(org.orgId, productId);
    assert.equal(stock.quantity, '16.000');

    // There is no quantity column anywhere — prove it rather than trust it.
    const cols = await adminSql`
      select column_name from information_schema.columns
      where table_name = 'products' and column_name like '%quantit%'`;
    assert.equal(cols.length, 0);
  });

  test('same product, expiry and lot merge into one batch', async () => {
    await receiveStock(org.orgId, { productId, quantity: '4', expiryDate: '2026-09-30' });
    const batches = await getBatchStock(org.orgId, productId, org.locationId);
    const sept = batches.filter((b) => b.expiryDate === '2026-09-30');
    assert.equal(sept.length, 1, 'a repeat delivery must not fragment the batch');
    assert.equal(sept[0].quantity, '14.000');
  });

  test('waste depletes earliest expiry first, spanning batches', async () => {
    // 6 @ 08-20 and 14 @ 09-30 on hand. Take 8: the near batch empties first.
    await recordWaste(org.orgId, { productId, quantity: '8', reasonCode: 'expired' });

    const batches = await getBatchStock(org.orgId, productId, org.locationId);
    assert.equal(batches.find((b) => b.expiryDate === '2026-08-20'), undefined);
    assert.equal(batches.find((b) => b.expiryDate === '2026-09-30')!.quantity, '12.000');

    const rows = await adminSql`
      select quantity_delta::text d from stock_movements
      where organization_id = ${org.orgId} and movement_type = 'waste'
      order by quantity_delta`;
    assert.deepEqual(rows.map((r) => r.d), ['-6.000', '-2.000']);
  });

  test('over-allocation is refused, not silently clamped', async () => {
    await assert.rejects(
      () => recordWaste(org.orgId, { productId, quantity: '9999', reasonCode: 'damaged' }),
      InsufficientStockError,
    );
    const [stock] = await getProductStock(org.orgId, productId);
    assert.equal(stock.quantity, '12.000', 'a refused write must leave nothing behind');
  });

  test('corrections are compensating rows, never edits', async () => {
    await adjustStock(org.orgId, { productId, quantityDelta: '-2', reasonCode: 'correction' });
    const [stock] = await getProductStock(org.orgId, productId);
    assert.equal(stock.quantity, '10.000');
  });

  test('a batchless negative adjustment comes out of a real batch', async () => {
    // Otherwise the product total drops but every batch keeps its quantity, and
    // expiring_stock overstates value at risk on the dashboard.
    const batches = await getBatchStock(org.orgId, productId, org.locationId);
    const batchTotal = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
    const [stock] = await getProductStock(org.orgId, productId);
    assert.equal(batchTotal, Number(stock.quantity), 'batches must sum to the product total');
  });

  test('the ledger rejects UPDATE and DELETE', async () => {
    await assert.rejects(
      () => adminSql`update stock_movements set quantity_delta = '999'
                     where organization_id = ${org.orgId}`,
      /append-only/,
    );
    await assert.rejects(
      () => adminSql`delete from stock_movements where organization_id = ${org.orgId}`,
      /append-only/,
    );
  });

  test('expiring stock reports value at risk', async () => {
    const rows = await getExpiringStock(org.orgId, 3650);
    const sept = rows.find((r) => r.expiryDate === '2026-09-30')!;
    assert.equal(sept.quantity, '10.000');
    // 10 × 0.80
    assert.equal(Number(sept.valueAtRisk), 8);
  });

  test('another tenant sees none of it', async () => {
    const other = await createTestOrg('Rival Grocer');
    assert.deepEqual(await getProductStock(other.orgId, productId), []);
    assert.deepEqual(await getBatchStock(other.orgId, productId, other.locationId), []);
    assert.deepEqual(await getExpiringStock(other.orgId, 3650), []);
  });
});
