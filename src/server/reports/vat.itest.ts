// The one report someone copies figures out of and onto a tax return, so the
// assertions here are written as a shopkeeper would state them, not as sums.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import Decimal from 'decimal.js';

import { createProduct } from '@/server/catalog/products';
import { checkout, voidSale } from '@/server/pos/checkout';
import { buildReport } from '@/server/reports';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

const row = (report: { rows: Record<string, string>[] }, band: string) =>
  report.rows.find((r) => r.vatBand === band);

describe('VAT report', () => {
  let org: TestOrg;
  let milk: string;
  let chocolate: string;

  before(async () => {
    org = await createTestOrg('VAT Report');
    await seedVatRatesForCountry(org.orgId, 'DE'); // reduced = 7%, standard = 19%

    // A basket of one €1.20 reduced-rate milk and one €1.20 standard-rate
    // chocolate bar takes €2.40 off the shopper — the sum of the shelf prices,
    // whatever the bands underneath.
    milk = (
      await createProduct(org.orgId, {
        name: 'Vollmilch 1L',
        gtin: '4001234567891',
        sellPrice: '1.2000',
        vatBand: 'reduced',
      })
    ).id;
    chocolate = (
      await createProduct(org.orgId, {
        name: 'Schokolade 100g',
        gtin: '4001234567907',
        sellPrice: '1.2000',
        vatBand: 'standard',
      })
    ).id;

    await receiveStock(org.orgId, { productId: milk, quantity: '50' });
    await receiveStock(org.orgId, { productId: chocolate, quantity: '50' });

    await checkout(org.orgId, {
      lines: [
        { productId: milk, quantity: '1' },
        { productId: chocolate, quantity: '1' },
      ],
      tenderType: 'cash',
    });
  });

  test('each band declares what the shopper actually handed over', async () => {
    const report = await buildReport(org.orgId, 'vat', 30);

    const reduced = row(report, 'reduced');
    const standard = row(report, 'standard');
    assert.ok(reduced && standard, 'both bands are listed');

    // Gross across the two bands is the €2.40 on the two shelf edges.
    const gross = new Decimal(reduced.gross).plus(standard.gross);
    assert.equal(gross.toFixed(2), '2.40');

    // And within each band, net plus VAT reconstructs the shelf price exactly —
    // the property a return depends on and the one independent rounding breaks.
    for (const r of [reduced, standard]) {
      assert.equal(new Decimal(r.net).plus(r.vat).toFixed(2), new Decimal(r.gross).toFixed(2));
    }

    // The rate is derived from what was charged, not read back off vat_rates.
    assert.equal(reduced.effectiveRate, '7.0');
    assert.equal(standard.effectiveRate, '19.0');
  });

  test('a rate changed today does not restate what was charged yesterday', async () => {
    // The reviewer's blocking question. Sales store their own vat_amount, so
    // moving the band now must leave the sale above exactly as it was.
    const before = await buildReport(org.orgId, 'vat', 30);
    await adminSql`
      update vat_rates set rate = 0.0500
      where organization_id = ${org.orgId} and band = 'reduced'`;
    const after = await buildReport(org.orgId, 'vat', 30);

    assert.deepEqual(after.rows, before.rows, 'history is what was charged, not what is charged');
  });

  test('a voided sale is not declared', async () => {
    const doomed = await checkout(org.orgId, {
      lines: [{ productId: chocolate, quantity: '10' }],
      tenderType: 'card',
    });
    const withIt = await buildReport(org.orgId, 'vat', 30);

    await voidSale(org.orgId, doomed.id);
    const withoutIt = await buildReport(org.orgId, 'vat', 30);

    // Voided sales keep their lines, so missing this filter over-declares.
    assert.notDeepEqual(withIt.rows, withoutIt.rows);
    assert.equal(row(withoutIt, 'standard')!.gross, '1.20');
  });

  test('a sale is declared in the period it happened, not the one it synced in', async () => {
    const late = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '1' }],
      tenderType: 'cash',
    });
    // An EPOS sale that rang up three months ago and only reached us today.
    await adminSql`
      update sales set occurred_at = now() - interval '100 days' where id = ${late.id}`;

    const quarter = await buildReport(org.orgId, 'vat', 30);
    assert.equal(row(quarter, 'reduced')!.gross, '1.20', 'the old sale is outside the window');

    const wider = await buildReport(org.orgId, 'vat', 90 + 30);
    assert.equal(row(wider, 'reduced')!.gross, '2.40', 'and inside a window that reaches it');
  });

  test('another tenant sees none of it', async () => {
    const rival = await createTestOrg('VAT Rival');
    assert.deepEqual((await buildReport(rival.orgId, 'vat', 30)).rows, []);
  });
});
