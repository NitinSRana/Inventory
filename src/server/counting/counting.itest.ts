import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { getDueForCount } from '@/server/counting/due';
import {
  ProductAlreadyCountedError,
  completeCountSession,
  getOpenSession,
  getSessionLines,
  getVarianceReport,
  listOpenSessions,
  recordCount,
  startCountSession,
} from '@/server/counting/sessions';
import { getProductStock } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

describe('cycle counting', () => {
  let org: TestOrg;
  let butter: string;
  let eggs: string;

  before(async () => {
    org = await createTestOrg('Counting Test');
    butter = (
      await createProduct(org.orgId, { name: 'Butter 250g', gtin: '4001234567891', costPrice: '2.0000' })
    ).id;
    eggs = (
      await createProduct(org.orgId, { name: 'Eier 10er', gtin: '4006381333931', costPrice: '1.5000' })
    ).id;
    await receiveStock(org.orgId, { productId: butter, quantity: '10', expiryDate: '2026-09-01' });
    await receiveStock(org.orgId, { productId: eggs, quantity: '4', expiryDate: '2026-08-25' });
  });


  test('a session stays open so an interrupted count survives', async () => {
    const session = await startCountSession(org.orgId, { name: 'Chiller 3' });
    const open = await getOpenSession(org.orgId);
    assert.equal(open?.id, session.id);
    assert.equal(open?.name, 'Chiller 3');
  });

  test('recounting a product replaces its line rather than duplicating it', async () => {
    const session = (await getOpenSession(org.orgId))!;
    await recordCount(org.orgId, { countSessionId: session.id, productId: butter, countedQuantity: '9' });
    await recordCount(org.orgId, { countSessionId: session.id, productId: butter, countedQuantity: '7' });

    const lines = await getSessionLines(org.orgId, session.id);
    const butterLines = lines.filter((l) => l.productId === butter);
    assert.equal(butterLines.length, 1, 'a corrected miscount must not create two truths');
    assert.equal(butterLines[0].countedQuantity, '7.000');
  });

  test('nothing reaches the ledger until the session completes', async () => {
    const [stock] = await getProductStock(org.orgId, butter);
    assert.equal(stock.quantity, '10.000', 'counting alone must not move stock');
  });

  test('variance reports direction and value', async () => {
    const session = (await getOpenSession(org.orgId))!;
    await recordCount(org.orgId, { countSessionId: session.id, productId: eggs, countedQuantity: '6' });

    const { summary, variances } = await getVarianceReport(org.orgId, session.id);
    assert.equal(summary.linesWithVariance, 2);
    assert.equal(summary.linesShort, 1);
    assert.equal(summary.linesOver, 1);
    // 3 butter short at 2.00, 2 eggs over at 1.50
    assert.equal(summary.shrinkValue, '6');
    assert.equal(summary.gainValue, '3');
    assert.equal(summary.netValue, '-3');
    assert.equal(variances.find((v) => v.productId === butter)!.delta, '-3');
  });

  test('completing posts one adjustment per differing line and closes the session', async () => {
    const session = (await getOpenSession(org.orgId))!;
    const result = await completeCountSession(org.orgId, session.id, org.userId);
    assert.equal(result.adjustmentsPosted, 2);

    assert.equal((await getProductStock(org.orgId, butter))[0].quantity, '7.000');
    assert.equal((await getProductStock(org.orgId, eggs))[0].quantity, '6.000');
    assert.equal(await getOpenSession(org.orgId), null);

    const rows = await adminSql`
      select reference_type, quantity_delta::text d from stock_movements
      where organization_id = ${org.orgId} and movement_type = 'count_adjustment'
      order by quantity_delta`;
    assert.deepEqual(rows.map((r) => r.d), ['-3.000', '2.000']);
    assert.ok(rows.every((r) => r.reference_type === 'count_session'));
  });

  test('a completed session cannot be completed twice', async () => {
    const [session] = await adminSql`
      select id from count_sessions where organization_id = ${org.orgId} limit 1`;
    await assert.rejects(() => completeCountSession(org.orgId, session.id), /not open/);
  });

  test('a count with no variance posts nothing', async () => {
    const session = await startCountSession(org.orgId, { name: 'No change' });
    await recordCount(org.orgId, { countSessionId: session.id, productId: butter, countedQuantity: '7' });
    const result = await completeCountSession(org.orgId, session.id);
    assert.equal(result.adjustmentsPosted, 0, 'a zero movement is rejected by CHECK and is noise anyway');
  });

  test('the due queue puts never-counted products first', async () => {
    const fresh = await createProduct(org.orgId, { name: 'Never Counted', gtin: '96385074' });
    const due = await getDueForCount(org.orgId);
    assert.equal(due[0].id, fresh.id);
    assert.equal(due[0].lastCountedAt, null);
    assert.equal(due[0].daysOverdue, 0, 'never counted is due now, not infinitely overdue');
    // Butter was counted moments ago on a monthly default, so it is not due.
    assert.equal(due.some((d) => d.id === butter), false);
  });

  test('another tenant sees none of it', async () => {
    const other = await createTestOrg('Counting Rival');
    assert.equal(await getOpenSession(other.orgId), null);
    assert.deepEqual(await getDueForCount(other.orgId), []);
  });

  describe('two people counting at once', () => {
    const anna = crypto.randomUUID();
    const pawel = crypto.randomUUID();
    let shop: TestOrg;
    let milk: string;
    let bread: string;

    before(async () => {
      shop = await createTestOrg('Two Counters');
      milk = (await createProduct(shop.orgId, { name: 'Milch', gtin: '4012345678994', costPrice: '1.0000' })).id;
      bread = (await createProduct(shop.orgId, { name: 'Brot', gtin: '4012345679007', costPrice: '2.0000' })).id;
      for (const id of [milk, bread]) {
        await receiveStock(shop.orgId, { productId: id, quantity: '40' });
      }
    });

    test('a second person starting a count does not steal the first', async () => {
      const annas = await startCountSession(shop.orgId, { name: 'Chiller', startedBy: anna });
      const pawels = await startCountSession(shop.orgId, { name: 'Dry goods', startedBy: pawel });
      assert.notEqual(annas.id, pawels.id, 'two people counting is the normal case, not a conflict');

      // Each must come back to their own aisle. Resolving the newest session for
      // everyone is what silently stranded the first person's work.
      assert.equal((await getOpenSession(shop.orgId, anna))?.id, annas.id);
      assert.equal((await getOpenSession(shop.orgId, pawel))?.id, pawels.id);
    });

    test('starting again returns the count already in progress', async () => {
      const first = await getOpenSession(shop.orgId, anna);
      const again = await startCountSession(shop.orgId, { name: 'Chiller', startedBy: anna });
      assert.equal(again.id, first!.id, 'a second start must resume, not strand what is counted');
    });

    test('neither count is invisible', async () => {
      const open = await listOpenSessions(shop.orgId);
      assert.equal(open.length, 2);
      assert.deepEqual(open.map((s) => s.name).sort(), ['Chiller', 'Dry goods']);
    });

    test('the same product cannot be on two open counts', async () => {
      const annas = (await getOpenSession(shop.orgId, anna))!;
      const pawels = (await getOpenSession(shop.orgId, pawel))!;

      await recordCount(shop.orgId, {
        countSessionId: annas.id,
        productId: milk,
        countedQuantity: '38',
        countedBy: anna,
      });

      // Both sessions measure their delta against the ledger as it stands now,
      // so letting this through posts -2 twice for a shelf counted once.
      await assert.rejects(
        () =>
          recordCount(shop.orgId, {
            countSessionId: pawels.id,
            productId: milk,
            countedQuantity: '38',
            countedBy: pawel,
          }),
        ProductAlreadyCountedError,
      );
    });

    test('both counts post, and the stock lands where it was counted', async () => {
      const annas = (await getOpenSession(shop.orgId, anna))!;
      const pawels = (await getOpenSession(shop.orgId, pawel))!;

      await recordCount(shop.orgId, {
        countSessionId: pawels.id,
        productId: bread,
        countedQuantity: '35',
        countedBy: pawel,
      });

      await completeCountSession(shop.orgId, annas.id, anna);
      await completeCountSession(shop.orgId, pawels.id, pawel);

      const [milkStock] = await getProductStock(shop.orgId, milk);
      const [breadStock] = await getProductStock(shop.orgId, bread);
      assert.equal(Number(milkStock.quantity), 38, 'Anna counted 38 milk, so the ledger says 38');
      assert.equal(Number(breadStock.quantity), 35, 'Pawel counted 35 bread, so the ledger says 35');

      assert.deepEqual(await listOpenSessions(shop.orgId), [], 'both counts are closed');
    });
  });
});
