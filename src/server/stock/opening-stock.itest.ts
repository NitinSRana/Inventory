// Opening stock writes receipts against real stock and is not idempotent, so
// what it refuses matters as much as what it accepts.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { getProductBatches, getProductStock } from '@/server/stock/levels';

import { importOpeningStockCsv } from './opening-stock';

const HEADER = 'barcode,sku,quantity,expiry_date,lot,unit_cost';

describe('opening stock import', () => {
  let org: TestOrg;

  before(async () => {
    org = await createTestOrg('Opening Stock');
    await createProduct(org.orgId, {
      name: 'Vollmilch 1L',
      gtin: '4001234567891',
      sku: 'VM1L',
      unit: 'l',
      dateType: 'use_by',
    });
    await createProduct(org.orgId, { name: 'Butter 250g', gtin: '4006381333931', sku: 'BU250' });
  });

  test('a dry run reports and writes nothing', async () => {
    const csv = [HEADER, '4001234567891,,24,2026-09-16,L1,0.79'].join('\n');
    const preview = await importOpeningStockCsv(org.orgId, csv, { dryRun: true });

    assert.deepEqual(preview.errors, []);
    assert.equal(preview.toReceive, 1);
    assert.equal(preview.received, 0);
    assert.deepEqual(await getProductStock(org.orgId), []);
  });

  test('rows land as receipts, and the date type comes from the product', async () => {
    const csv = [
      HEADER,
      // Same product twice with different expiry dates — two batches, not two
      // products, which is the shape a real shelf actually has.
      '4001234567891,,24,2026-09-16,L1,0.79',
      '4001234567891,,6,2026-09-20,L2,0.79',
      // Identified by SKU rather than barcode, and with no expiry at all.
      ',BU250,10,,,1.10',
    ].join('\n');

    const result = await importOpeningStockCsv(org.orgId, csv);
    assert.deepEqual(result.errors, []);
    assert.equal(result.received, 3);

    const [milk] = await getProductStock(org.orgId).then((rows) =>
      rows.filter((r) => Number(r.quantity) === 30),
    );
    assert.ok(milk, 'the two milk rows add up on one product');

    const batches = await getProductBatches(org.orgId, milk.productId!);
    assert.equal(batches.length, 2, 'different expiry dates stay different batches');
    assert.ok(
      batches.every((b) => b.dateType === 'use_by'),
      'the date type is read off the product, never off the file',
    );
  });

  test('a file naming a product that does not exist is refused whole', async () => {
    const before = await getProductStock(org.orgId);
    const csv = [
      HEADER,
      '4001234567891,,5,2026-10-01,,0.79',
      '9999999999994,,5,2026-10-01,,0.79',
    ].join('\n');

    const result = await importOpeningStockCsv(org.orgId, csv);
    assert.equal(result.received, 0);
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['unknownProduct'],
    );
    // The good row must not have landed either: a half-applied opening balance
    // is worse than none, because nobody can say afterwards which half it was.
    assert.deepEqual(await getProductStock(org.orgId), before);
  });

  test('the same batch listed twice at two costs is a mistake, not a merge', async () => {
    const csv = [
      HEADER,
      '4001234567891,,5,2026-11-01,L9,0.79',
      '4001234567891,,5,2026-11-01,L9,0.95',
    ].join('\n');

    const result = await importOpeningStockCsv(org.orgId, csv, { dryRun: true });
    // Only the first cost is ever stored on a batch, so the second would vanish
    // without a word and quietly misvalue the stock.
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['conflictingCost'],
    );
  });

  test('a date that is not ISO is refused rather than guessed', async () => {
    const csv = [HEADER, '4001234567891,,5,03/04/2026,,0.79'].join('\n');
    const result = await importOpeningStockCsv(org.orgId, csv, { dryRun: true });
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['notADate'],
    );

    // A real-looking date that does not exist is refused too.
    const impossible = [HEADER, '4001234567891,,5,2026-02-30,,0.79'].join('\n');
    const second = await importOpeningStockCsv(org.orgId, impossible, { dryRun: true });
    assert.deepEqual(
      second.errors.map((e) => e.message),
      ['notADate'],
    );
  });

  test('an unrecognised column is named, and a missing quantity column is fatal', async () => {
    const csv = ['barcode,quantity,shelf', '4001234567891,5,Aisle 2'].join('\n');
    const withExtra = await importOpeningStockCsv(org.orgId, csv, { dryRun: true });
    assert.deepEqual(withExtra.unknownColumns, ['shelf']);
    assert.deepEqual(withExtra.errors, []);

    const noQuantity = await importOpeningStockCsv(
      org.orgId,
      ['barcode,expiry_date', '4001234567891,2026-09-16'].join('\n'),
      { dryRun: true },
    );
    assert.deepEqual(
      noQuantity.errors.map((e) => e.message),
      ['missingQuantityColumn'],
    );
  });

  test('another tenant cannot be stocked through this file', async () => {
    const rival = await createTestOrg('Opening Rival');
    const csv = [HEADER, '4001234567891,,5,2026-09-16,,0.79'].join('\n');

    const result = await importOpeningStockCsv(rival.orgId, csv);
    assert.equal(result.received, 0, 'the barcode belongs to another shop');
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['unknownProduct'],
    );
  });
});
