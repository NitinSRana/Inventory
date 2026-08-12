import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { InsufficientStockError } from '@/server/stock/fefo';
import { getBatchStock, getProductStock } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import { UnpricedProductError, checkout, voidSale } from './checkout';

/**
 * Checkout against a real database: the transaction that ties a sale, its
 * lines and the ledger together, plus FEFO and VAT computed for real.
 */
describe('checkout', () => {
  let org: TestOrg;
  let milk: string;
  let bread: string;

  before(async () => {
    org = await createTestOrg('Checkout Test');
    await seedVatRatesForCountry(org.orgId, 'DE'); // reduced = 7%, standard = 19%

    milk = (
      await createProduct(org.orgId, {
        name: 'Vollmilch 1L',
        gtin: '4001234567891',
        sellPrice: '1.2900',
        vatBand: 'reduced',
      })
    ).id;
    bread = (
      await createProduct(org.orgId, {
        name: 'Bauernbrot',
        gtin: '4001234567907',
        sellPrice: '2.4900',
        vatBand: 'reduced',
      })
    ).id;

    await receiveStock(org.orgId, { productId: milk, quantity: '20', expiryDate: '2026-09-30' });
    await receiveStock(org.orgId, { productId: bread, quantity: '20', expiryDate: '2026-08-20' });
  });

  test('subtotal, VAT and total are computed from the product, not the caller', async () => {
    const sale = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '2' }],
      tenderType: 'card',
    });

    assert.equal(sale.subtotal, '2.5800'); // 1.29 * 2
    assert.equal(sale.vatTotal, '0.1806'); // 2.58 * 0.07
    assert.equal(sale.total, '2.7606');
    assert.match(sale.saleNumber, /^TXN-\d{4}-\d{4}$/);
  });

  test('stock depletes by exactly what was sold', async () => {
    const before = await getProductStock(org.orgId, bread);
    await checkout(org.orgId, { lines: [{ productId: bread, quantity: '3' }], tenderType: 'cash' });
    const [after] = await getProductStock(org.orgId, bread);
    assert.equal(Number(after.quantity), Number(before[0].quantity) - 3);

    const [movement] = await adminSql`
      select movement_type, reference_type, quantity_delta::text d from stock_movements
      where organization_id = ${org.orgId} and product_id = ${bread}
      order by created_at desc limit 1`;
    assert.equal(movement.movement_type, 'consumption');
    assert.equal(movement.reference_type, 'sale');
    assert.equal(movement.d, '-3.000');
  });

  test('depletes FEFO across batches, same as a write-off', async () => {
    const fresh = (
      await createProduct(org.orgId, { name: 'Joghurt', gtin: '4001234567914', sellPrice: '0.9900', vatBand: 'reduced' })
    ).id;
    // 6 expiring 08-20 and 14 expiring 09-30.
    await receiveStock(org.orgId, { productId: fresh, quantity: '6', expiryDate: '2026-08-20' });
    await receiveStock(org.orgId, { productId: fresh, quantity: '14', expiryDate: '2026-09-30' });

    await checkout(org.orgId, { lines: [{ productId: fresh, quantity: '8' }], tenderType: 'card' });

    const batches = await getBatchStock(org.orgId, fresh, org.locationId);
    assert.equal(batches.find((b) => b.expiryDate === '2026-08-20'), undefined, 'near batch must empty first');
    assert.equal(batches.find((b) => b.expiryDate === '2026-09-30')!.quantity, '12.000');
  });

  test('scanning the same product twice merges into one line, not a conflict', async () => {
    const sale = await checkout(org.orgId, {
      lines: [
        { productId: milk, quantity: '1' },
        { productId: milk, quantity: '2' },
      ],
      tenderType: 'cash',
    });

    const lines = await adminSql`select quantity::text q from sale_lines where sale_id = ${sale.id}`;
    assert.equal(lines.length, 1, 'must be one line, or it would violate unique(sale_id, product_id)');
    assert.equal(lines[0].q, '3.000');
  });

  test('a product with no sell price cannot be sold', async () => {
    const unpriced = (await createProduct(org.orgId, { name: 'No Price Yet', gtin: '4001234567921' })).id;
    await receiveStock(org.orgId, { productId: unpriced, quantity: '5' });

    await assert.rejects(
      () => checkout(org.orgId, { lines: [{ productId: unpriced, quantity: '1' }], tenderType: 'cash' }),
      UnpricedProductError,
    );
  });

  test('insufficient stock refuses the whole sale, not a partial one', async () => {
    const scarce = (
      await createProduct(org.orgId, { name: 'Scarce Item', gtin: '4001234567938', sellPrice: '5.0000' })
    ).id;
    await receiveStock(org.orgId, { productId: scarce, quantity: '2' });

    await assert.rejects(
      () => checkout(org.orgId, { lines: [{ productId: scarce, quantity: '5' }], tenderType: 'card' }),
      InsufficientStockError,
    );

    const [stock] = await getProductStock(org.orgId, scarce);
    assert.equal(stock.quantity, '2.000', 'a refused sale must leave nothing behind');

    const [linked] = await adminSql`select count(*)::int n from sale_lines where product_id = ${scarce}`;
    assert.equal(linked.n, 0, 'the failed checkout must not have posted a line');
  });

  test('voiding restores the stock and closes the sale', async () => {
    const item = (
      await createProduct(org.orgId, { name: 'Void Test Item', gtin: '4001234567945', sellPrice: '3.0000' })
    ).id;
    await receiveStock(org.orgId, { productId: item, quantity: '10' });

    const sale = await checkout(org.orgId, { lines: [{ productId: item, quantity: '4' }], tenderType: 'card' });
    const [afterSale] = await getProductStock(org.orgId, item);
    assert.equal(afterSale.quantity, '6.000');

    const voided = await voidSale(org.orgId, sale.id);
    assert.equal(voided!.status, 'voided');
    assert.ok(voided!.voidedAt);

    const [afterVoid] = await getProductStock(org.orgId, item);
    assert.equal(afterVoid.quantity, '10.000', 'voiding must restore exactly what the sale removed');
  });

  test('a voided sale cannot be voided again', async () => {
    const item = (
      await createProduct(org.orgId, { name: 'Double Void', gtin: '4001234567952', sellPrice: '1.0000' })
    ).id;
    await receiveStock(org.orgId, { productId: item, quantity: '5' });
    const sale = await checkout(org.orgId, { lines: [{ productId: item, quantity: '1' }], tenderType: 'cash' });

    await voidSale(org.orgId, sale.id);
    await assert.rejects(() => voidSale(org.orgId, sale.id));
  });

  test('another tenant cannot check out against this tenant products', async () => {
    const other = await createTestOrg('Checkout Rival');
    await assert.rejects(() =>
      checkout(other.orgId, { lines: [{ productId: milk, quantity: '1' }], tenderType: 'cash' }),
    );
  });
});
