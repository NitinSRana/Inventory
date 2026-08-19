import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { getProductStock } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

import { externalSale, FixtureSalesSource } from './sources/fixture';
import { applyExternalSales, syncFromSource, windowSince } from './sync';

/**
 * The external POS import pipeline, against a real database.
 *
 * Written entirely against FixtureSalesSource — that is the point of the
 * port/adapter split. Every rule the ledger depends on is proved here today,
 * with no API credentials and no network, so finishing the EposNow adapter is
 * only ever about HTTP.
 */
describe('external POS sync', () => {
  let org: TestOrg;
  let milk: string;
  let chocolate: string;
  let multipack: string;

  const MILK = '5000112637922';
  const CHOC = '5000159484695';
  const PACK_UNIT = '5012345678900';
  const PACK_CASE = '15012345678907';

  before(async () => {
    org = await createTestOrg('EPOS Shop');
    await seedVatRatesForCountry(org.orgId, 'GB');

    milk = (
      await createProduct(org.orgId, {
        name: 'Milk 2L', gtin: MILK, sellPrice: '1.2000', vatBand: 'zero',
      })
    ).id;
    chocolate = (
      await createProduct(org.orgId, {
        name: 'Chocolate', gtin: CHOC, sellPrice: '1.2000', vatBand: 'standard',
      })
    ).id;
    multipack = (
      await createProduct(org.orgId, {
        name: 'Crisps 6pk', gtin: PACK_UNIT, caseGtin: PACK_CASE, unitsPerCase: '6',
        sellPrice: '0.5000', vatBand: 'standard',
      })
    ).id;

    await receiveStock(org.orgId, { productId: milk, quantity: '50' });
    await receiveStock(org.orgId, { productId: chocolate, quantity: '50' });
    await receiveStock(org.orgId, { productId: multipack, quantity: '50' });
  });

  test('imports a sale and depletes stock', async () => {
    const [before] = await getProductStock(org.orgId, milk);

    const r = await applyExternalSales(org.orgId, [
      externalSale('TXN-1001', [{ barcode: MILK, quantity: '2', unitPrice: '1.2000' }]),
    ]);

    assert.equal(r.imported, 1);
    assert.equal(r.unmatched, 0);

    const [after] = await getProductStock(org.orgId, milk);
    assert.equal(Number(after.quantity), Number(before.quantity) - 2);
  });

  /**
   * The one that matters most. Syncs get retried — a timeout, a redeploy
   * mid-run, an anxious shopkeeper pressing the button again. Re-importing
   * would deplete stock twice, and because stock_movements is append-only that
   * damage cannot be edited away.
   */
  test('re-importing the same sale changes nothing', async () => {
    const sale = externalSale('TXN-2002', [{ barcode: MILK, quantity: '3', unitPrice: '1.2000' }]);

    await applyExternalSales(org.orgId, [sale]);
    const [afterFirst] = await getProductStock(org.orgId, milk);

    const second = await applyExternalSales(org.orgId, [sale]);
    const [afterSecond] = await getProductStock(org.orgId, milk);

    assert.equal(second.imported, 0, 'the second run must import nothing');
    assert.equal(second.skipped, 1);
    assert.equal(afterSecond.quantity, afterFirst.quantity, 'stock must not move twice');

    const [rows] = await adminSql`
      select count(*)::int n from sales
      where organization_id = ${org.orgId} and external_ref = 'TXN-2002'`;
    assert.equal(rows.n, 1, 'exactly one sale row');
  });

  test('an overlapping window is harmless, which is why we overlap', async () => {
    const at = new Date();
    const source = new FixtureSalesSource([
      externalSale('TXN-3003', [{ barcode: MILK, quantity: '1', unitPrice: '1.2000' }], { occurredAt: at }),
    ]);

    const first = await syncFromSource(org.orgId, source);
    // Same window again, exactly as a rewound high-water mark would do.
    const second = await syncFromSource(org.orgId, source, { syncedThrough: first.syncedThrough });

    assert.equal(first.imported, 1);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 1);
  });

  /**
   * An external sale already happened: the money is taken and the goods are
   * gone. Refusing it would leave the ledger claiming stock that is not on the
   * shelf, so it goes negative instead — a true signal that a delivery was
   * never recorded.
   */
  test('a sale we have no stock for still imports, and drives stock negative', async () => {
    const ghost = (
      await createProduct(org.orgId, {
        name: 'Never Received', gtin: '5000112637939', sellPrice: '2.0000', vatBand: 'zero',
      })
    ).id;

    const r = await applyExternalSales(org.orgId, [
      externalSale('TXN-4004', [{ barcode: '5000112637939', quantity: '4', unitPrice: '2.0000' }]),
    ]);

    assert.equal(r.imported, 1, 'the sale is a fact and must be recorded');
    assert.equal(r.oversold, 1);

    const [stock] = await getProductStock(org.orgId, ghost);
    assert.equal(Number(stock.quantity), -4, 'negative on hand is the honest answer');
  });

  test('an unknown barcode is queued, never dropped', async () => {
    const r = await applyExternalSales(org.orgId, [
      externalSale('TXN-5005', [
        { barcode: MILK, quantity: '1', unitPrice: '1.2000' },
        { barcode: '5099999999998', quantity: '2', description: 'Mystery Item' },
      ]),
    ]);

    assert.equal(r.imported, 1, 'the matched line still imports');
    assert.equal(r.unmatched, 1);

    const [row] = await adminSql`
      select barcode, description, quantity::text q, times_seen from pos_unmatched_lines
      where organization_id = ${org.orgId} and barcode = '5099999999998'`;
    assert.equal(row.description, 'Mystery Item');
    assert.equal(row.q, '2.000');
  });

  test('the same unknown barcode accumulates into one row, not forty', async () => {
    await applyExternalSales(org.orgId, [
      externalSale('TXN-6006', [{ barcode: '5099999999981', quantity: '2' }]),
    ]);
    await applyExternalSales(org.orgId, [
      externalSale('TXN-6007', [{ barcode: '5099999999981', quantity: '3' }]),
    ]);

    const rows = await adminSql`
      select quantity::text q, times_seen from pos_unmatched_lines
      where organization_id = ${org.orgId} and barcode = '5099999999981'`;
    assert.equal(rows.length, 1, 'one row per barcode');
    assert.equal(rows[0].q, '5.000', 'quantities accumulate');
    assert.equal(rows[0].times_seen, 2);
  });

  test('money is computed the same way our own till computes it', async () => {
    await applyExternalSales(org.orgId, [
      externalSale('TXN-7007', [
        { barcode: MILK, quantity: '2', unitPrice: '1.2000' }, // zero-rated
        { barcode: CHOC, quantity: '1', unitPrice: '1.2000' }, // standard 20%
      ]),
    ]);

    const [sale] = await adminSql`
      select subtotal::text s, vat_total::text v, total::text t, source
      from sales where organization_id = ${org.orgId} and external_ref = 'TXN-7007'`;

    assert.equal(sale.source, 'epos_now');
    assert.equal(sale.t, '3.6000', 'the shelf prices, exactly — VAT extracted, never added');
    assert.equal(sale.v, '0.2000');
    assert.equal(sale.s, '3.4000');
    assert.equal(Number(sale.s) + Number(sale.v), Number(sale.t));
  });

  test('a case barcode sells the whole case, converted to units', async () => {
    const [before] = await getProductStock(org.orgId, multipack);

    await applyExternalSales(org.orgId, [
      externalSale('TXN-8008', [{ barcode: PACK_CASE, quantity: '2', unitPrice: '3.0000' }]),
    ]);

    const [after] = await getProductStock(org.orgId, multipack);
    assert.equal(
      Number(after.quantity),
      Number(before.quantity) - 12,
      '2 cases x 6 units, not 2 units',
    );
  });

  test('the same product listed twice merges into one line', async () => {
    await applyExternalSales(org.orgId, [
      externalSale('TXN-9009', [
        { barcode: MILK, quantity: '1', unitPrice: '1.2000' },
        { barcode: MILK, quantity: '2', unitPrice: '1.2000' },
      ]),
    ]);

    const lines = await adminSql`
      select quantity::text q from sale_lines
      where sale_id = (select id from sales where organization_id = ${org.orgId} and external_ref = 'TXN-9009')`;
    assert.equal(lines.length, 1, 'or it would violate unique(sale_id, product_id)');
    assert.equal(lines[0].q, '3.000');
  });

  test('a merged line with two different prices sums to what was actually paid', async () => {
    // A promo unit alongside a full-price one — merging must not let the later
    // line's price silently overwrite the earlier line's value.
    await applyExternalSales(org.orgId, [
      externalSale('TXN-9010', [
        { barcode: MILK, quantity: '1', unitPrice: '0.5000' },
        { barcode: MILK, quantity: '2', unitPrice: '1.2000' },
      ]),
    ]);

    const [line] = await adminSql`
      select quantity::text q, unit_price::text up, line_total::text lt
      from sale_lines
      where sale_id = (select id from sales where organization_id = ${org.orgId} and external_ref = 'TXN-9010')`;

    assert.equal(line.q, '3.000');
    assert.equal(line.lt, '2.9000', '0.50 x 1 + 1.20 x 2, not 1.20 x 3');
    assert.equal(line.up, '0.9667', 'weighted average, for display only');
  });

  test('the sale is dated when it happened, not when we heard about it', async () => {
    const happened = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await applyExternalSales(org.orgId, [
      externalSale('TXN-1010', [{ barcode: MILK, quantity: '1', unitPrice: '1.2000' }], {
        occurredAt: happened,
      }),
    ]);

    const [sale] = await adminSql`
      select occurred_at from sales
      where organization_id = ${org.orgId} and external_ref = 'TXN-1010'`;
    assert.equal(
      Math.abs(new Date(sale.occurred_at).getTime() - happened.getTime()) < 1000,
      true,
      'a sync at 23:00 must not date the whole day to 23:00',
    );
  });

  test('one bad sale does not roll back the rest of the day', async () => {
    const r = await applyExternalSales(org.orgId, [
      externalSale('TXN-1111', [{ barcode: MILK, quantity: '1', unitPrice: '1.2000' }]),
      { ...externalSale('TXN-1112', [{ barcode: MILK, quantity: '1' }]), isRefund: true },
      externalSale('TXN-1113', [{ barcode: MILK, quantity: '1', unitPrice: '1.2000' }]),
    ]);

    assert.equal(r.imported, 2, 'the two good sales import');
    assert.equal(r.errors.length, 1, 'the refund is reported, not silently dropped');
  });

  test('another tenant cannot import against this tenant products', async () => {
    const other = await createTestOrg('EPOS Rival');
    const r = await applyExternalSales(other.orgId, [
      externalSale('TXN-1212', [{ barcode: MILK, quantity: '1', unitPrice: '1.2000' }]),
    ]);

    assert.equal(r.imported, 0, 'our barcode must not resolve inside their tenant');
    assert.equal(r.unmatched, 1, 'it should look like an unknown barcode to them');
  });
});

describe('sync window', () => {
  test('a first sync looks back a day, not all of history', () => {
    const now = new Date('2026-08-18T12:00:00Z');
    assert.equal(windowSince(null, now).toISOString(), '2026-08-17T12:00:00.000Z');
  });

  test('later syncs rewind, because a provider can backdate a transaction', () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const through = new Date('2026-08-18T11:00:00Z');
    assert.equal(windowSince(through, now).toISOString(), '2026-08-18T10:30:00.000Z');
  });
});
