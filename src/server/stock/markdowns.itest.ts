// Markdowns move money, so every assertion here is written as a shopper or an
// owner would state it — what was handed over, what was recovered — rather than
// as a formula.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import Decimal from 'decimal.js';

import { createProduct } from '@/server/catalog/products';
import { checkout, previewBasket } from '@/server/pos/checkout';
import { receiveStock } from '@/server/stock/movements';
import { adminSql, createTestOrg } from '@/server/testing/fixtures';

import {
  MarkdownRefusedError,
  clearBatchMarkdown,
  getMitigatedLosses,
  setBatchMarkdown,
} from './markdowns';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A zero-rated milk with an old batch (expiring soon) and a fresh one behind it. */
async function shopWithMilk(name: string) {
  const org = await createTestOrg(name);
  const milk = await createProduct(org.orgId, {
    name: 'Vollmilch 1L',
    gtin: '4001234567891',
    sellPrice: '1.2900',
    vatBand: 'zero',
    dateType: 'best_before',
  });
  const old = await receiveStock(org.orgId, { productId: milk.id, quantity: '2', expiryDate: inDays(2) });
  const fresh = await receiveStock(org.orgId, { productId: milk.id, quantity: '5', expiryDate: inDays(12) });
  return { org, milk, oldBatch: old.batchId!, freshBatch: fresh.batchId! };
}

describe('markdowns', () => {
  test('two reduced cartons and one fresh one cost what the two labels say', async () => {
    const { org, milk, oldBatch } = await shopWithMilk('Markdown Basket');
    await setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '0.99', actorId: org.userId });

    // FEFO takes the two old cartons first: 2 × 0.99 + 1 × 1.29 = 3.27.
    const sale = await checkout(org.orgId, {
      lines: [{ productId: milk.id, quantity: '3' }],
      tenderType: 'cash',
    });
    assert.equal(new Decimal(sale.total).toFixed(2), '3.27');

    const lines = await adminSql`
      select unit_price::text u, list_price::text l, quantity::text q,
             line_total::text t, vat_amount::text v
      from sale_lines where sale_id = ${sale.id} order by unit_price`;
    assert.deepEqual(
      lines.map((l) => [new Decimal(l.u).toFixed(2), new Decimal(l.l).toFixed(2), new Decimal(l.q).toString()]),
      [
        ['0.99', '1.29', '2'],
        ['1.29', '1.29', '1'],
      ],
      'one line per price, each carrying the shelf price it was cut from',
    );
  });

  test('net plus VAT reconstructs every line of a marked-down sale', async () => {
    const org = await createTestOrg('Markdown VAT');
    await adminSql`
      insert into vat_rates (organization_id, band, rate) values (${org.orgId}, 'standard', 0.19)`;
    const choc = await createProduct(org.orgId, {
      name: 'Schokolade 100g',
      gtin: '4001234567907',
      sellPrice: '1.1900',
      vatBand: 'standard',
      dateType: 'best_before',
    });
    const old = await receiveStock(org.orgId, { productId: choc.id, quantity: '3', expiryDate: inDays(1) });
    await receiveStock(org.orgId, { productId: choc.id, quantity: '3', expiryDate: inDays(30) });
    await setBatchMarkdown(org.orgId, { batchId: old.batchId!, price: '0.89' });

    const sale = await checkout(org.orgId, { lines: [{ productId: choc.id, quantity: '4' }], tenderType: 'card' });
    const lines = await adminSql`
      select line_total::text t, vat_amount::text v, (line_total - vat_amount)::text n
      from sale_lines where sale_id = ${sale.id}`;
    assert.equal(lines.length, 2);
    for (const l of lines) {
      assert.equal(new Decimal(l.n).plus(l.v).toFixed(4), new Decimal(l.t).toFixed(4));
    }
    // 3 × 0.89 + 1 × 1.19 = 3.86 handed over.
    assert.equal(new Decimal(sale.total).toFixed(2), '3.86');

    // What the markdown recovered is the reduced chocolate ex-VAT: 2.67 taken,
    // 2.24 of it the shop's, 0.43 owed as VAT either way. Reported gross it
    // would sit beside a value-at-risk tile priced at cost and compare the two
    // sides of VAT on one screen.
    assert.equal(await getMitigatedLosses(org.orgId), '2.24');
  });

  test('the screen previews exactly what the till then charges', async () => {
    const { org, milk, oldBatch } = await shopWithMilk('Markdown Preview');
    await setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '0.99' });
    const basket = [{ productId: milk.id, quantity: '3' }];

    const preview = await previewBasket(org.orgId, basket);
    const sale = await checkout(org.orgId, { lines: basket, tenderType: 'cash' });

    assert.equal(new Decimal(preview.total).toFixed(2), new Decimal(sale.total).toFixed(2));
    assert.equal(preview.lines.filter((l) => l.markedDown).length, 1, 'the reduced line is flagged');
  });

  test('a markdown has to be a reduction', async () => {
    const { org, oldBatch } = await shopWithMilk('Markdown Not Lower');
    await assert.rejects(
      () => setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '1.29' }),
      (e: unknown) => e instanceof MarkdownRefusedError && e.reason === 'notBelowShelf',
    );
    await assert.rejects(
      () => setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '0' }),
      (e: unknown) => e instanceof MarkdownRefusedError && e.reason === 'invalidPrice',
    );
  });

  test('an expired use-by batch cannot be marked down, because it cannot be sold', async () => {
    const org = await createTestOrg('Markdown Use By');
    const ham = await createProduct(org.orgId, {
      name: 'Kochschinken 200g',
      gtin: '4001234567914',
      sellPrice: '2.9900',
      vatBand: 'zero',
      dateType: 'use_by',
    });
    const expired = await receiveStock(org.orgId, {
      productId: ham.id,
      quantity: '4',
      expiryDate: inDays(-1),
      dateType: 'use_by',
    });
    await assert.rejects(
      () => setBatchMarkdown(org.orgId, { batchId: expired.batchId!, price: '0.99' }),
      (e: unknown) => e instanceof MarkdownRefusedError && e.reason === 'expiredUseBy',
    );
  });

  test('clearing a markdown puts the batch back to shelf price', async () => {
    const { org, milk, oldBatch } = await shopWithMilk('Markdown Clear');
    await setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '0.99' });
    await clearBatchMarkdown(org.orgId, oldBatch);

    const sale = await checkout(org.orgId, { lines: [{ productId: milk.id, quantity: '2' }], tenderType: 'cash' });
    assert.equal(new Decimal(sale.total).toFixed(2), '2.58');
  });

  test('mitigated losses count only marked-down lines, and never move when the price does', async () => {
    const { org, milk, oldBatch } = await shopWithMilk('Markdown Mitigated');
    await setBatchMarkdown(org.orgId, { batchId: oldBatch, price: '0.99' });
    await checkout(org.orgId, { lines: [{ productId: milk.id, quantity: '3' }], tenderType: 'cash' });

    // Two cartons that would have gone in the bin brought in 1.98. The fresh
    // carton sold at shelf price is ordinary takings, not a recovered loss.
    assert.equal(await getMitigatedLosses(org.orgId), '1.98');

    // Someone reprices the milk afterwards. Last sale's lines already say what
    // they were sold at and against which shelf price; that cannot change.
    await adminSql`update products set sell_price = 0.50 where id = ${milk.id}`;
    assert.equal(await getMitigatedLosses(org.orgId), '1.98');
  });

  test('another shop cannot mark down this shop\'s batch', async () => {
    const { oldBatch } = await shopWithMilk('Markdown Owner');
    const rival = await createTestOrg('Markdown Rival');

    await assert.rejects(
      () => setBatchMarkdown(rival.orgId, { batchId: oldBatch, price: '0.10' }),
      (e: unknown) => e instanceof MarkdownRefusedError && e.reason === 'notFound',
    );
    const [batch] = await adminSql`select markdown_price from batches where id = ${oldBatch}`;
    assert.equal(batch.markdown_price, null, 'untouched');
    assert.equal(await getMitigatedLosses(rival.orgId), '0');
  });
});
