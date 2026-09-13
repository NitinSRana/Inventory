// The check-then-import step. Its whole value is that the first pass writes
// nothing and still tells the truth about what the second one would do.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createTestOrg } from '@/server/testing/fixtures';

import { importProductsCsv } from './import';
import { listProducts } from './products';
import { createSupplier } from './suppliers';

const CSV = [
  'name,barcode,price,aisle notes,notes',
  'Vollmilch 1L,4001234567891,1.29,Aisle 3,cold',
  'Butter 250g,4006381333931,2.49,Aisle 3,',
].join('\n');

describe('import preview', () => {
  test('a dry run reports what would happen and writes nothing', async () => {
    const org = await createTestOrg('Import Preview');

    const preview = await importProductsCsv(org.orgId, CSV, { dryRun: true });
    assert.deepEqual(preview.errors, []);
    assert.equal(preview.toCreate, 2);
    assert.equal(preview.created, 0, 'a dry run never claims to have written');
    assert.deepEqual(await listProducts(org.orgId), [], 'and it really did not');

    // The mapping check: a column no alias covers is named rather than dropped.
    assert.deepEqual(preview.unknownColumns, ['aisle notes', 'notes']);

    // The sample is what someone actually reads to spot a shifted column.
    assert.deepEqual(preview.sample, [
      { name: 'Vollmilch 1L', gtin: '4001234567891', sellPrice: '1.29', isUpdate: false },
      { name: 'Butter 250g', gtin: '4006381333931', sellPrice: '2.49', isUpdate: false },
    ]);
  });

  test('confirming the same text imports exactly what was previewed', async () => {
    const org = await createTestOrg('Import Confirm');

    const preview = await importProductsCsv(org.orgId, CSV, { dryRun: true });
    const result = await importProductsCsv(org.orgId, CSV);

    assert.equal(result.created, preview.toCreate);
    assert.equal(result.updated, preview.toUpdate);
    assert.equal((await listProducts(org.orgId)).length, 2);

    // Re-running matches on barcode, so the second pass is an update, not a
    // duplicate — and the preview says so before anything is written.
    const again = await importProductsCsv(org.orgId, CSV, { dryRun: true });
    assert.equal(again.toCreate, 0);
    assert.equal(again.toUpdate, 2);
    assert.ok(again.sample.every((r) => r.isUpdate));
  });

  test('creating the suppliers a file names clears the block', async () => {
    const org = await createTestOrg('Import Suppliers');
    const csv = [
      'name,barcode,price,supplier',
      'Vollmilch 1L,4001234567891,1.29,Molkerei Nord',
      'Butter 250g,4006381333931,2.49,Molkerei Nord',
      'Brot 500g,5012345678900,1.10,Backerei Sud',
    ].join('\n');

    const blocked = await importProductsCsv(org.orgId, csv, { dryRun: true });
    // Named once each, not once per row — three rows, two suppliers.
    assert.deepEqual(blocked.unknownSuppliers, ['Molkerei Nord', 'Backerei Sud']);
    assert.equal(blocked.errors.length, 3, 'every row referencing one is held back');

    for (const name of blocked.unknownSuppliers) await createSupplier(org.orgId, { name });

    const result = await importProductsCsv(org.orgId, csv);
    assert.deepEqual(result.errors, [], 'the same file now imports untouched');
    assert.equal(result.created, 3);
    assert.ok(
      (await listProducts(org.orgId)).every((p) => p.supplierId),
      'and every product is attached to its supplier',
    );
  });
});
