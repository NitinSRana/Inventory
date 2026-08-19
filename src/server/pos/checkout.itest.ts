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

    /*
     * sellPrice is the SHELF price — VAT included. So 1.29 x 2 is what the
     * customer pays, and VAT is extracted from it rather than added on top.
     *   gross 2.58, net 2.58 / 1.07 = 2.4112, VAT the remainder.
     */
    assert.equal(sale.subtotal, '2.4112');
    assert.equal(sale.vatTotal, '0.1688');
    assert.equal(sale.total, '2.5800', 'the customer pays the shelf price, never more');
    assert.match(sale.saleNumber, /^TXN-\d{4}-\d{4}$/);
  });

  test('net plus VAT always reconstructs the shelf price exactly', async () => {
    // A rate that does not divide cleanly: 0.99 / 1.07 recurs. Deriving net and
    // taking VAT as the remainder is what stops a penny going missing here.
    const odd = (
      await createProduct(org.orgId, {
        name: 'Odd Price Item',
        gtin: '4001234567969',
        sellPrice: '0.9900',
        vatBand: 'reduced',
      })
    ).id;
    await receiveStock(org.orgId, { productId: odd, quantity: '10' });

    const sale = await checkout(org.orgId, {
      lines: [{ productId: odd, quantity: '3' }],
      tenderType: 'cash',
    });

    assert.equal(sale.total, '2.9700', '0.99 x 3, to the penny');
    assert.equal(
      Number(sale.subtotal) + Number(sale.vatTotal),
      Number(sale.total),
      'net + VAT must equal the total exactly, with no rounding drift',
    );
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

/**
 * A UK corner shop, which is the case that matters most.
 *
 * UK food VAT is split down the middle of a single aisle: milk is zero-rated,
 * the chocolate next to it is standard-rated at 20%. The shop owner types shelf
 * prices, and the customer must pay exactly those prices — VAT is the till's
 * problem, not theirs.
 *
 * This is the test that would have caught the bug where VAT was added on top of
 * the shelf price, turning a £1.20 chocolate bar into £1.44 at the till.
 */
describe('checkout — UK mixed VAT basket', () => {
  let org: TestOrg;
  let milk: string;
  let chocolate: string;

  before(async () => {
    org = await createTestOrg('UK Corner Shop');
    await seedVatRatesForCountry(org.orgId, 'GB'); // standard 20%, reduced 5%, zero 0%

    milk = (
      await createProduct(org.orgId, {
        name: 'Semi-Skimmed Milk 2L',
        gtin: '5000112637922',
        sellPrice: '1.2000',
        vatBand: 'zero', // most food
      })
    ).id;
    chocolate = (
      await createProduct(org.orgId, {
        name: 'Chocolate Bar',
        gtin: '5000159484695',
        sellPrice: '1.2000',
        vatBand: 'standard', // confectionery is the exception
      })
    ).id;

    await receiveStock(org.orgId, { productId: milk, quantity: '20' });
    await receiveStock(org.orgId, { productId: chocolate, quantity: '20' });
  });

  test('the customer pays the sum of the shelf prices, nothing more', async () => {
    const sale = await checkout(org.orgId, {
      lines: [
        { productId: milk, quantity: '2' }, // 2.40, zero-rated
        { productId: chocolate, quantity: '1' }, // 1.20, standard-rated
      ],
      tenderType: 'cash',
    });

    assert.equal(sale.total, '3.6000', '1.20 x 2 + 1.20 — exactly what the shelf edge says');
    // Zero-rated milk contributes no VAT; the chocolate's 1.20 gross is
    // 1.00 net + 0.20 VAT.
    assert.equal(sale.vatTotal, '0.2000');
    assert.equal(sale.subtotal, '3.4000');
  });

  test('zero-rated lines carry no VAT at all', async () => {
    const sale = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '3' }],
      tenderType: 'card',
    });

    assert.equal(sale.vatTotal, '0.0000');
    assert.equal(sale.subtotal, sale.total, 'with no VAT, net and gross are the same number');
    assert.equal(sale.total, '3.6000');
  });
});
