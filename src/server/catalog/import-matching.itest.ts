// Which existing product a re-imported row is the *same* product as.
//
// This shop has ~2,000 products and roughly two-thirds of them carry no unit
// barcode, so "match on GTIN" answers the question for a minority of the
// catalogue. What happens to the rest is the difference between a re-import
// being routine and being something nobody dares run twice.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { importProductsCsv } from './import';
import { listProducts } from './products';
import { createTestOrg } from '@/server/testing/fixtures';

const file = (...rows: string[]) => ['name,barcode,sku,price', ...rows].join('\n');

describe('re-import matching', () => {
  test('a product with a SKU and no barcode updates instead of duplicating', async () => {
    const org = await createTestOrg('Match By Sku');

    const first = await importProductsCsv(org.orgId, file('Vollmilch 1L,,VM1L,1.29'));
    assert.equal(first.created, 1);

    // The same file again — the commonest thing anyone does with a spreadsheet.
    const again = await importProductsCsv(org.orgId, file('Vollmilch 1L,,VM1L,1.35'));
    assert.equal(again.created, 0, 'nothing new');
    assert.equal(again.updated, 1, 'the existing product, matched on its SKU');

    const products = await listProducts(org.orgId);
    assert.equal(products.length, 1, 'one product, not two');
    assert.equal(products[0].sellPrice, '1.3500', 'and the new price landed');
  });

  test('a re-import can give a product the barcode it never had', async () => {
    const org = await createTestOrg('Sku Gains Barcode');
    await importProductsCsv(org.orgId, file('Butter 250g,,BU250,2.49'));

    // The whole reason this matters here: it is how a catalogue with no
    // barcodes gets them, one supplier file at a time.
    const result = await importProductsCsv(org.orgId, file('Butter 250g,4006381333931,BU250,2.49'));
    assert.equal(result.updated, 1);

    const [product] = await listProducts(org.orgId);
    assert.equal(product.gtin, '4006381333931');
  });

  test('a blank barcode column does not wipe a barcode already on the product', async () => {
    const org = await createTestOrg('Blank Keeps Barcode');
    await importProductsCsv(org.orgId, file('Brot 500g,5012345678900,BRD500,1.10'));

    // A file exported from a system that does not carry barcodes at all.
    await importProductsCsv(org.orgId, file('Brot 500g,,BRD500,1.20'));

    const [product] = await listProducts(org.orgId);
    assert.equal(product.gtin, '5012345678900', 'silence is not an instruction to delete');
    assert.equal(product.sellPrice, '1.2000');
  });

  test('the barcode decides which product a row is, and the SKU follows', async () => {
    const org = await createTestOrg('Barcode Precedence');
    await importProductsCsv(org.orgId, file('Old Name,4001234567891,OLD1,1.00'));

    // Barcode matches, SKU is new: the barcode is the stronger claim, so this
    // is the same product under a new article number.
    const result = await importProductsCsv(org.orgId, file('Renamed,4001234567891,NEW1,1.50'));
    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);

    const products = await listProducts(org.orgId);
    assert.equal(products.length, 1, 'renumbered, not duplicated');
    assert.equal(products[0].name, 'Renamed');
    assert.equal(products[0].sku, 'NEW1');
  });

  test('a SKU that still belongs to another product is refused, not moved', async () => {
    const org = await createTestOrg('Sku Tug Of War');
    await importProductsCsv(
      org.orgId,
      file('Old Name,4001234567891,OLD1,1.00', 'Other,,OTHER1,2.00'),
    );

    // The barcode says one product; the SKU is on a different one. Silently
    // moving an article number between products is not something a spreadsheet
    // should do by accident — and left unchecked it kills the whole import on
    // a constraint with no line number attached.
    const result = await importProductsCsv(org.orgId, file('Renamed,4001234567891,OTHER1,1.50'));
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['skuOnAnotherProduct'],
    );

    const products = await listProducts(org.orgId);
    assert.equal(products.length, 2);
    assert.ok(products.some((p) => p.name === 'Old Name'), 'nothing was renamed');
  });

  test('the same SKU twice in one file is a row error, not a crash', async () => {
    const org = await createTestOrg('Duplicate Sku');
    const result = await importProductsCsv(
      org.orgId,
      file('Vollmilch 1L,,VM1L,1.29', 'Vollmilch 1L again,,VM1L,1.35'),
    );

    // Both rows resolve to the same product, so without this the whole import
    // dies on a Postgres error nobody can act on.
    assert.deepEqual(
      result.errors.map((e) => e.message),
      ['duplicateSkuInFile'],
    );
    assert.equal(result.created, 0, 'and nothing landed');
  });

  test('a SKU another shop uses matches nothing here', async () => {
    const theirs = await createTestOrg('Their Shop');
    await importProductsCsv(theirs.orgId, file('Their Milk,4001234567891,SHARED,1.00'));

    // The upsert now conflicts on the primary key, and the id it uses comes
    // from a lookup inside withTenant — so RLS is the only thing standing
    // between two shops that happen to number their articles the same way.
    const ours = await createTestOrg('Our Shop');
    const result = await importProductsCsv(ours.orgId, file('Our Milk,4001234567891,SHARED,9.99'));
    assert.equal(result.created, 1, 'ours is a new product, not an update of theirs');

    const theirProducts = await listProducts(theirs.orgId);
    assert.equal(theirProducts.length, 1);
    assert.equal(theirProducts[0].name, 'Their Milk', 'untouched');
    assert.equal(theirProducts[0].sellPrice, '1.0000');
  });

  test('a row with neither a barcode nor a SKU still has nothing to match on', async () => {
    const org = await createTestOrg('Nothing To Match');
    await importProductsCsv(org.orgId, file('Loose Tomatoes,,,2.99'));
    await importProductsCsv(org.orgId, file('Loose Tomatoes,,,2.99'));

    // Documented, not fixed: a name is not an identifier. Two shops' worth of
    // experience says matching on it renames the wrong product eventually.
    assert.equal((await listProducts(org.orgId)).length, 2);
  });
});
