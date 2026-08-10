import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createSupplier } from '@/server/catalog/suppliers';
import { completeCountSession, recordCount, startCountSession } from '@/server/counting/sessions';
import { recalculateConsumptionRates } from '@/server/consumption/calculate';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  markPurchaseOrderSent,
  receiveAgainstPurchaseOrder,
} from '@/server/purchasing/orders';
import { getReorderSuggestions } from '@/server/purchasing/reorder';
import { getProductStock } from '@/server/stock/levels';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg, type TestOrg } from '@/server/testing/fixtures';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);

async function onOrder(orgId: string) {
  const [row] = await adminSql`
    select coalesce(sum(quantity_on_order), 0)::text q
    from on_order_quantities where organization_id = ${orgId}`;
  return row.q;
}

describe('purchase orders', () => {
  let org: TestOrg;
  let supplierId: string;
  let productId: string;
  let poId: string;
  let lineId: string;

  before(async () => {
    org = await createTestOrg('Purchasing Test');
    supplierId = (await createSupplier(org.orgId, { name: 'Metro AG', leadTimeDays: 5 })).id;
    productId = (
      await createProduct(org.orgId, {
        name: 'Vollmilch 1L',
        gtin: '4001234567891',
        costPrice: '0.7900',
        supplierId,
      })
    ).id;
  });


  test('a draft does not count against reorder suggestions', async () => {
    const po = await createPurchaseOrder(org.orgId, {
      supplierId,
      lines: [{ productId, quantity: '20', unitCost: '0.7900' }],
    });
    poId = po.id;
    assert.equal(po.status, 'draft');
    assert.equal(await onOrder(org.orgId), '0', 'a draft left sitting must not suppress the suggestion');
  });

  test('sending is what starts it counting', async () => {
    await markPurchaseOrderSent(org.orgId, poId);
    assert.equal(await onOrder(org.orgId), '20.000');
    const po = (await getPurchaseOrder(org.orgId, poId))!;
    assert.equal(po.status, 'sent');
    assert.equal(po.total, '15.80');
    lineId = po.lines[0].id;
  });

  test('a sent order cannot be sent again', async () => {
    await assert.rejects(() => markPurchaseOrderSent(org.orgId, poId), /not a draft/);
  });

  test('partial delivery moves stock and leaves the rest outstanding', async () => {
    const { discrepancies } = await receiveAgainstPurchaseOrder(org.orgId, poId, [
      { lineId, quantity: '8', expiryDate: '2026-12-01' },
    ]);
    assert.equal(discrepancies.length, 0);

    const po = (await getPurchaseOrder(org.orgId, poId))!;
    assert.equal(po.status, 'partially_received');
    assert.equal(po.lines[0].quantityReceived, '8.000');
    assert.equal((await getProductStock(org.orgId, productId))[0].quantity, '8.000');
    assert.equal(await onOrder(org.orgId), '12.000');
  });

  test('the receipt is traceable back to the order', async () => {
    const rows = await adminSql`
      select reference_type, reference_id from stock_movements
      where organization_id = ${org.orgId} and reference_type = 'purchase_order'`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reference_id, poId);
  });

  test('over-delivery is recorded and flagged, not rejected', async () => {
    const { discrepancies } = await receiveAgainstPurchaseOrder(org.orgId, poId, [
      { lineId, quantity: '14', expiryDate: '2026-12-15' },
    ]);
    assert.equal(discrepancies.length, 1);
    assert.equal(discrepancies[0].ordered, '20.000');
    assert.equal(discrepancies[0].received, '22');

    const po = (await getPurchaseOrder(org.orgId, poId))!;
    assert.equal(po.status, 'received');
    // The stock is physically on the shelf; refusing it would make the ledger lie.
    assert.equal((await getProductStock(org.orgId, productId))[0].quantity, '22.000');
    assert.equal(await onOrder(org.orgId), '0');
  });

  test('a received order cannot be cancelled', async () => {
    await assert.rejects(() => cancelPurchaseOrder(org.orgId, poId), /open purchase order/);
  });

  test('cancelling keeps delivered stock and frees the outstanding quantity', async () => {
    const po = await createPurchaseOrder(org.orgId, {
      supplierId,
      lines: [{ productId, quantity: '30', unitCost: '0.7900' }],
    });
    await markPurchaseOrderSent(org.orgId, po.id);
    const line = (await getPurchaseOrder(org.orgId, po.id))!.lines[0];
    await receiveAgainstPurchaseOrder(org.orgId, po.id, [{ lineId: line.id, quantity: '5' }]);
    assert.equal(await onOrder(org.orgId), '25.000');

    await cancelPurchaseOrder(org.orgId, po.id);
    assert.equal((await getPurchaseOrder(org.orgId, po.id))!.status, 'cancelled');
    assert.equal(await onOrder(org.orgId), '0');
    assert.equal((await getProductStock(org.orgId, productId))[0].quantity, '27.000');
  });

  test('another tenant sees no orders', async () => {
    const other = await createTestOrg('Purchasing Rival');
    assert.equal(await getPurchaseOrder(other.orgId, poId), null);
  });
});

describe('reorder suggestions', () => {
  let org: TestOrg;
  let productId: string;
  let supplierId: string;

  before(async () => {
    org = await createTestOrg('Reorder Test');
    supplierId = (await createSupplier(org.orgId, { name: 'Molkerei Nord', leadTimeDays: 5 })).id;
    productId = (
      await createProduct(org.orgId, {
        name: 'Vollmilch 1L',
        gtin: '4001234567891',
        costPrice: '0.8000',
        supplierId,
      })
    ).id;

    // Two counts ten days apart: 20 opening, +30 in, 2 binned, 18 closing
    // => 30 consumed over 10 days => 3/day.
    await receiveStock(org.orgId, { productId, quantity: '20', expiryDate: '2026-12-01', occurredAt: daysAgo(11) });
    const first = await startCountSession(org.orgId, { name: 'W1' });
    await recordCount(org.orgId, { countSessionId: first.id, productId, countedQuantity: '20' });
    await completeCountSession(org.orgId, first.id);
    await adminSql`update count_lines set counted_at = ${daysAgo(10)}
                   where count_session_id = ${first.id}`;

    await receiveStock(org.orgId, { productId, quantity: '30', expiryDate: '2026-12-01', occurredAt: daysAgo(5) });
    await adminSql`insert into stock_movements
      (organization_id, product_id, location_id, quantity_delta, movement_type, reason_code, occurred_at)
      values (${org.orgId}, ${productId}, ${org.locationId}, '-2', 'waste', 'damaged', ${daysAgo(4)})`;

    const second = await startCountSession(org.orgId, { name: 'W2' });
    await recordCount(org.orgId, { countSessionId: second.id, productId, countedQuantity: '18' });
    await completeCountSession(org.orgId, second.id);
    await recalculateConsumptionRates(org.orgId);
  });


  test('a rate is derived without a single sale being recorded', async () => {
    const { groups } = await getReorderSuggestions(org.orgId);
    const line = groups[0].lines.find((l) => l.productId === productId)!;
    assert.equal(line.dailyRate, '3.0000');
    // 3/day × (5 lead + 3 safety) = 24, less 18 on hand => 6
    assert.equal(line.suggestedQuantity, '6');
  });

  test('an open order removes the suggestion instead of double-ordering', async () => {
    const po = await createPurchaseOrder(org.orgId, {
      supplierId,
      lines: [{ productId, quantity: '6', unitCost: '0.8000' }],
    });
    await markPurchaseOrderSent(org.orgId, po.id);

    const { groups } = await getReorderSuggestions(org.orgId);
    assert.equal(groups.length, 0, 'the outstanding order already covers the shortfall');
  });

  test('products without two counts are reported, never guessed at', async () => {
    await createProduct(org.orgId, { name: 'Unknown Rate', gtin: '4006381333931', supplierId });
    const { withoutRate } = await getReorderSuggestions(org.orgId);
    assert.ok(withoutRate >= 1, 'silence would read as "nothing to order"');
  });
});
