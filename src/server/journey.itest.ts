import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { importProductsCsv } from '@/server/catalog/import';
import { listProducts } from '@/server/catalog/products';
import { createSupplier } from '@/server/catalog/suppliers';
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import {
  completeCountSession,
  getVarianceReport,
  recordCount,
  startCountSession,
} from '@/server/counting/sessions';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderSent,
  receiveAgainstPurchaseOrder,
} from '@/server/purchasing/orders';
import { getReorderSuggestions } from '@/server/purchasing/reorder';
import { buildReport } from '@/server/reports';
import { seedVatRatesForCountry } from '@/server/settings/vat';
import { getExpiringStock, getExpiryExposure, getProductStock } from '@/server/stock/levels';
import { recordWaste, receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg } from '@/server/testing/fixtures';

/**
 * One shop's first three weeks, in order, as a single narrative.
 *
 * The per-module suites each prove their own piece. None of them proves the
 * pieces compose: that a catalogue imported on Monday produces a consumption
 * rate a fortnight later, that the rate produces an order, that receiving the
 * order stops it being suggested again. Every number a store owner will ever
 * act on is the output of that whole chain, and a break anywhere in it is
 * invisible to a test that only looks at one link.
 *
 * The steps are the real user journey — sign up, build a catalogue, receive,
 * count, write off, count again, reorder, receive against the order — and they
 * run against the same server functions the screens call.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe('a store first three weeks', () => {
  let org: Awaited<ReturnType<typeof createTestOrg>>;
  const product: Record<string, string> = {};
  let supplierId: string;

  test('day 0 — a new shop starts with nothing to show', async () => {
    org = await createTestOrg('Journey Grocer');
    await seedVatRatesForCountry(org.orgId, 'DE');

    assert.deepEqual(await listProducts(org.orgId), [], 'a new org must not see anyone else rows');
    const { groups, withoutRate } = await getReorderSuggestions(org.orgId);
    assert.deepEqual(groups, [], 'nothing to order before anything is known');
    assert.equal(withoutRate, 0);
  });

  test('day 0 — the catalogue arrives as a supplier CSV, not typed in', async () => {
    // The supplier has to exist first: the file names them, and an import that
    // invented suppliers would quietly create duplicates of the real ones.
    const supplier = await createSupplier(org.orgId, {
      name: 'Molkerei Nord',
      leadTimeDays: 2,
      minOrderValue: '20.0000',
    });
    supplierId = supplier.id;

    const csv = [
      'name,barcode,sku,unit,cost,price,min_stock,shelf_life_days,supplier',
      'Vollmilch 1L,4001234567891,VM1L,l,0.79,1.29,20,10,Molkerei Nord',
      '"Milch, fettarm 1L",4006381333931,MF1L,l,0.75,1.19,20,10,Molkerei Nord',
    ].join('\n');

    const result = await importProductsCsv(org.orgId, csv);
    assert.deepEqual(result.errors, [], 'the template the app hands out must import cleanly');
    assert.equal(result.created, 2);

    for (const p of await listProducts(org.orgId)) product[p.name] = p.id;
    // The quoted comma in the German name must survive the round trip; a shear
    // here would silently create a product called "Milch".
    assert.ok(product['Milch, fettarm 1L'], 'a quoted comma must not split a row');
  });

  test('day 0 — the opening delivery lands and the shop can see what it holds', async () => {
    for (const name of Object.keys(product)) {
      await receiveStock(org.orgId, {
        productId: product[name],
        quantity: '40',
        expiryDate: inDays(10),
        unitCost: '0.79',
        occurredAt: daysAgo(21),
      });
    }

    const [stock] = await getProductStock(org.orgId, product['Vollmilch 1L']);
    assert.equal(Number(stock.quantity), 40);

    // The dashboard's headline figure: money at risk, not a unit count.
    const exposure = await getExpiryExposure(org.orgId, 14);
    assert.equal(exposure.batchCount, 2, 'both batches expire inside the window');
    assert.ok(
      Number(exposure.valueAtRisk) > 0,
      'received stock with an expiry must show a value at risk',
    );
  });

  test('day 7 — the first count establishes a baseline and posts nothing', async () => {
    const session = await startCountSession(org.orgId, { name: 'Chiller', startedBy: org.userId });
    for (const name of Object.keys(product)) {
      await recordCount(org.orgId, {
        countSessionId: session.id,
        productId: product[name],
        countedQuantity: '40',
      });
    }

    const { variances } = await getVarianceReport(org.orgId, session.id);
    assert.deepEqual(variances, [], 'a count that matches the ledger must post no adjustment');

    await completeCountSession(org.orgId, session.id, org.userId);
    await adminSql`update count_lines set counted_at = ${daysAgo(14)}
                   where count_session_id = ${session.id}`;

    // One count is a point, not a rate. Guessing from a single observation is
    // exactly the wrong-number-worse-than-no-number case the spec calls out.
    await recalculateConsumptionRates(org.orgId);
    const { withoutRate } = await getReorderSuggestions(org.orgId);
    assert.equal(withoutRate, 2, 'one count cannot produce a rate for either product');
  });

  test('day 18 — stock goes out of the door as waste', async () => {
    await recordWaste(org.orgId, {
      productId: product['Vollmilch 1L'],
      quantity: '4',
      reasonCode: 'expired',
      actorId: org.userId,
    });

    const [stock] = await getProductStock(org.orgId, product['Vollmilch 1L']);
    assert.equal(Number(stock.quantity), 36, 'waste must leave the ledger lower, not equal');
  });

  test('day 21 — the second count is where consumption finally becomes knowable', async () => {
    const session = await startCountSession(org.orgId, { name: 'Chiller', startedBy: org.userId });
    // Sold down from 36 to 8: fourteen days of trading, minus the four binned.
    await recordCount(org.orgId, {
      countSessionId: session.id,
      productId: product['Vollmilch 1L'],
      countedQuantity: '8',
    });
    await recordCount(org.orgId, {
      countSessionId: session.id,
      productId: product['Milch, fettarm 1L'],
      countedQuantity: '12',
    });

    const { variances, summary } = await getVarianceReport(org.orgId, session.id);
    assert.equal(variances.length, 2, 'both products moved, so both must show a variance');
    assert.ok(Number(summary.netValue) < 0, 'stock went down, so the value impact is negative');

    await completeCountSession(org.orgId, session.id, org.userId);

    // The ledger must now agree with the shelf. This is the whole promise of a
    // count: afterwards the number in the app is the number in the aisle.
    const [stock] = await getProductStock(org.orgId, product['Vollmilch 1L']);
    assert.equal(Number(stock.quantity), 8, 'after a count the ledger must equal what was counted');

    await recalculateConsumptionRates(org.orgId);
  });

  test('day 21 — two counts produce an order the owner can check by hand', async () => {
    const { groups, withoutRate } = await getReorderSuggestions(org.orgId);
    assert.equal(withoutRate, 0, 'both products now have two counts, so both can be advised on');
    assert.equal(groups.length, 1, 'one supplier, one order');

    const group = groups[0];
    assert.equal(group.supplierId, supplierId);
    assert.equal(group.leadTimeDays, 2);
    assert.equal(group.lines.length, 2);

    for (const line of group.lines) {
      assert.ok(Number(line.suggestedQuantity) > 0, `${line.productName} must be worth ordering`);
      // A grocer orders whole bottles. Fractions here are the fastest way to
      // lose their trust in every other number on the screen.
      assert.match(line.suggestedQuantity, /^\d+$/, `${line.suggestedQuantity} is not orderable`);
    }
  });

  test('day 21 — the suggestion becomes a real order', async () => {
    const { groups } = await getReorderSuggestions(org.orgId);
    const po = await createPurchaseOrder(org.orgId, {
      supplierId,
      createdBy: org.userId,
      lines: groups[0].lines.map((l) => ({
        productId: l.productId,
        quantity: l.suggestedQuantity,
        unitCost: l.costPrice,
      })),
    });

    const created = await getPurchaseOrder(org.orgId, po.id);
    assert.equal(created!.status, 'draft');
    assert.match(created!.poNumber, /^PO-\d{4}-\d{4}$/);

    // A draft is not on order. Until it is sent it must not suppress a
    // suggestion, or a forgotten draft silently stops the shop reordering.
    const stillSuggested = await getReorderSuggestions(org.orgId);
    assert.equal(stillSuggested.groups.length, 1, 'a draft must not count as on order');

    await markPurchaseOrderSent(org.orgId, po.id);
    const afterSending = await getReorderSuggestions(org.orgId);
    assert.equal(afterSending.groups.length, 0, 'a sent order must stop the same suggestion');

    process.env.JOURNEY_PO = po.id;
  });

  test('day 23 — the delivery arrives short, and the shortfall stays outstanding', async () => {
    const poId = process.env.JOURNEY_PO!;
    const po = await getPurchaseOrder(org.orgId, poId);
    const line = po!.lines[0];
    const short = String(Number(line.quantityOrdered) - 2);

    const before = await getProductStock(org.orgId, line.productId);
    await receiveAgainstPurchaseOrder(
      org.orgId,
      poId,
      [{ lineId: line.id, quantity: short, expiryDate: inDays(10), lotNumber: 'L-1' }],
      org.userId,
    );

    const after = await getProductStock(org.orgId, line.productId);
    assert.equal(
      Number(after[0].quantity) - Number(before[0]?.quantity ?? 0),
      Number(short),
      'what was received must be what reaches the shelf',
    );

    const updated = await getPurchaseOrder(org.orgId, poId);
    assert.equal(updated!.status, 'partially_received');
    assert.equal(Number(updated!.lines[0].quantityReceived), Number(short));
  });

  test('day 23 — the shop can still answer the four questions it bought this for', async () => {
    const expiring = await getExpiringStock(org.orgId, 14);
    assert.ok(expiring.length > 0, 'the delivery just received has an expiry date');
    assert.ok(
      expiring.every((r) => r.productName && r.valueAtRisk !== null),
      'every row must name a product and a value, or the dashboard cannot be acted on',
    );

    for (const slug of ['stock', 'waste', 'expiry', 'low-stock'] as const) {
      const report = await buildReport(org.orgId, slug, 30);
      assert.ok(report.columns.length > 0, `${slug} must define its columns`);
    }

    const waste = await buildReport(org.orgId, 'waste', 30);
    assert.equal(waste.rows.length, 1, 'the one write-off must appear in the waste report');
  });

  /**
   * Found by trying to tidy up after this test and being refused.
   *
   * The append-only trigger is doing exactly its job, and the job is right: a
   * ledger you can delete from is not a ledger. But it also means there is no
   * path to erasing a tenant, and GDPR Article 17 is not optional for a product
   * sold in the EU on its data-residency posture. `scripts/seed.mts` works
   * around it by disabling the trigger, which is not something request-handling
   * code may ever do.
   *
   * Documented as a passing test rather than a note in a chat window, so that
   * whoever implements erasure has to come here and change it deliberately.
   */
  test('a tenant cannot currently be erased, and GDPR needs it to be', async () => {
    await assert.rejects(
      () => adminSql`delete from organizations where id = ${org.orgId}`,
      /append-only/,
      'if this now passes, erasure became possible — write the erasure path a test',
    );
  });
});
