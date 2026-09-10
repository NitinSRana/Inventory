// The catalogue import at this shop's real size and shape: 2,051 products, of
// which roughly two thirds carry no unit barcode.
//
// The matching tests next door prove the rules on three rows. This proves they
// still hold when the file is the one someone actually has, and says out loud
// what a re-import costs in time and in duplicated rows.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { countProducts, importProductsCsv } from './import';
import { listProducts } from './products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';

/** Their catalogue, as reported: 1,370 of 2,051 with no unit barcode. */
const TOTAL = 2051;
const NO_BARCODE = 1370;
/** Loose produce and deli lines: no barcode and no article number either. */
const NO_IDENTIFIER = 30;
const SKU_ONLY = NO_BARCODE - NO_IDENTIFIER;

/** A real EAN-13, because normalizeGtin checks the check digit. */
function ean13(seed: number): string {
  // Twelve digits before the check digit — truncating a thirteen-digit number
  // silently collides the first ten seeds.
  const body = String(400000000000 + seed);
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

const header = 'name,barcode,sku,price,vat_band';

/** @param withBarcodes give the SKU-only products a barcode too. */
function catalogue(withBarcodes: boolean): string {
  const rows: string[] = [header];
  for (let i = 0; i < TOTAL; i++) {
    const barcoded = i < TOTAL - NO_BARCODE;
    const identifiable = i < TOTAL - NO_IDENTIFIER;
    const barcode = barcoded || (withBarcodes && identifiable) ? ean13(i) : '';
    const sku = identifiable ? `SKU${String(i).padStart(5, '0')}` : '';
    rows.push(`Product ${i},${barcode},${sku},${(1 + (i % 900) / 100).toFixed(2)},zero`);
  }
  return rows.join('\n');
}

describe('catalogue import at 2,000 products', () => {
  let org: TestOrg;
  const took: Record<string, number> = {};

  const timed = async (label: string, run: () => Promise<unknown>) => {
    const started = Date.now();
    const result = await run();
    took[label] = Date.now() - started;
    return result;
  };

  before(async () => {
    org = await createTestOrg('Scale Test');
  });

  test('the whole catalogue lands in one statement', async () => {
    const result = (await timed('first import', () =>
      importProductsCsv(org.orgId, catalogue(false)),
    )) as Awaited<ReturnType<typeof importProductsCsv>>;

    assert.deepEqual(result.errors, []);
    assert.equal(result.created, TOTAL);
    assert.equal(await countProducts(org.orgId), TOTAL);
  });

  test('re-importing the same file duplicates only what has no identifier', async () => {
    const result = (await timed('re-import', () =>
      importProductsCsv(org.orgId, catalogue(false)),
    )) as Awaited<ReturnType<typeof importProductsCsv>>;

    // This is the number that matters. Before the SKU fallback the whole file
    // died on products_org_sku_uniq; now every row carrying either identifier
    // updates in place.
    assert.equal(result.updated, TOTAL - NO_IDENTIFIER);
    assert.equal(result.created, NO_IDENTIFIER, 'a name is not an identifier');
    assert.equal(await countProducts(org.orgId), TOTAL + NO_IDENTIFIER);
  });

  test('a second file fills in the barcodes the catalogue never had', async () => {
    const before = await countProducts(org.orgId);

    const result = (await timed('barcode enrichment', () =>
      importProductsCsv(org.orgId, catalogue(true)),
    )) as Awaited<ReturnType<typeof importProductsCsv>>;

    assert.deepEqual(result.errors, []);
    assert.equal(result.updated, TOTAL - NO_IDENTIFIER, 'matched on SKU, not barcode');
    assert.equal(
      await countProducts(org.orgId),
      before + NO_IDENTIFIER,
      'only the unidentifiable rows are new again',
    );

    // The point of the whole exercise for this shop.
    const products = await listProducts(org.orgId, { limit: 5000 });
    const gained = products.filter((p) => p.sku?.startsWith('SKU') && p.gtin).length;
    assert.equal(gained, TOTAL - NO_IDENTIFIER, `${SKU_ONLY} products gained a barcode`);

    console.log('    timings:', JSON.stringify(took));
  });

  test('a file too big for one statement still lands or fails whole', async () => {
    // The driver binds a parameter per column per row and refuses past 65,534,
    // so a file this size is written as several statements. They share the
    // transaction — and that is the part worth proving, because chunking is
    // exactly what would quietly turn an all-or-nothing import into a partial
    // one that nobody could unpick afterwards.
    const org = await createTestOrg('Chunk Boundary');
    const big = (lastRowValid: boolean) => {
      const rows = ['name,sku,price'];
      for (let i = 0; i < 5000; i++) {
        const price = !lastRowValid && i === 4999 ? 'not-a-number' : '1.00';
        rows.push(`Product ${i},BIG${i},${price}`);
      }
      return rows.join('\n');
    };

    const spoiled = await importProductsCsv(org.orgId, big(false));
    assert.deepEqual(
      spoiled.errors.map((e) => e.column),
      ['sellPrice'],
      'one bad row, near the end, in a later chunk',
    );
    assert.equal(await countProducts(org.orgId), 0, 'and the earlier chunks did not stay');

    const clean = await importProductsCsv(org.orgId, big(true));
    assert.equal(clean.created, 5000);
    assert.equal(await countProducts(org.orgId), 5000);
  });

  test('a constraint that only fires mid-insert rolls the earlier chunks back', async () => {
    // The test above proves validation refuses a file before touching anything,
    // which says nothing about the transaction. This one fails *during* the
    // write, in a later chunk, on a collision validation cannot see: a case
    // barcode already held by a product that is not in the file.
    const org = await createTestOrg('Chunk Rollback');
    const seed = ['name,sku,case_barcode', 'Incumbent,KEEP1,15000112637929'].join('\n');
    await importProductsCsv(org.orgId, seed);
    assert.equal(await countProducts(org.orgId), 1);

    const rows = ['name,sku,case_barcode'];
    for (let i = 0; i < 5000; i++) {
      rows.push(`Product ${i},CLASH${i},${i === 4999 ? '15000112637929' : ''}`);
    }

    await assert.rejects(() => importProductsCsv(org.orgId, rows.join('\n')));
    assert.equal(
      await countProducts(org.orgId),
      1,
      'the first chunk was already written and had to come back out',
    );
  });
});
