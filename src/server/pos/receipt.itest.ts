// The receipt is a legal document a shop hands to a customer, so what it shows
// is worth proving rather than trusting the checkout total alone.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { createProduct } from '@/server/catalog/products';
import { createTestOrg, type TestOrg } from '@/server/testing/fixtures';
import { seedVatRatesForCountry } from '@/server/settings/vat';

import { checkout, getSale, voidSale } from './checkout';
import { receiveStock } from '@/server/stock/movements';

describe('the receipt', () => {
  let org: TestOrg;
  let milk: string; // reduced-rate
  let wine: string; // standard-rate

  before(async () => {
    org = await createTestOrg('Receipt');
    await seedVatRatesForCountry(org.orgId, 'DE'); // standard 19%, reduced 7%
    const m = await createProduct(org.orgId, {
      name: 'Vollmilch 1L', gtin: '4001234567891', sellPrice: '1.19', vatBand: 'reduced',
    });
    const w = await createProduct(org.orgId, {
      name: 'Rotwein 750ml', gtin: '4006381333931', sellPrice: '8.00', vatBand: 'standard',
    });
    milk = m.id;
    wine = w.id;
    await receiveStock(org.orgId, { productId: milk, quantity: '500' });
    await receiveStock(org.orgId, { productId: wine, quantity: '500' });
  });

  test('carries a sale number, tender, lines and a total that adds up', async () => {
    const posted = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '2' }, { productId: wine, quantity: '1' }],
      tenderType: 'cash',
    });

    const receipt = await getSale(org.orgId, posted.id);
    assert.ok(receipt);
    assert.match(receipt!.sale.saleNumber, /^TXN-\d{4}-\d{4}$/);
    assert.equal(receipt!.sale.tenderType, 'cash');
    assert.equal(receipt!.lines.length, 2);

    const summed = receipt!.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    assert.ok(Math.abs(summed - Number(receipt!.sale.total)) < 0.001, 'lines sum to the sale total');
  });

  test('VAT is broken out by band, not just summed', async () => {
    const posted = await checkout(org.orgId, {
      lines: [{ productId: milk, quantity: '10' }, { productId: wine, quantity: '2' }],
      tenderType: 'card',
    });
    const receipt = await getSale(org.orgId, posted.id);

    assert.equal(receipt!.vatBreakdown.length, 2, 'two bands were actually charged');
    const standard = receipt!.vatBreakdown.find((b) => b.band === 'standard')!;
    const reduced = receipt!.vatBreakdown.find((b) => b.band === 'reduced')!;

    // sellPrice is gross (the shelf price); checkout extracts VAT from it
    // rather than adding it on top.
    // 2 x 8.00 = 16.00 gross, / 1.19 -> 13.4454 net, 19% -> 2.5546
    assert.equal(standard.net, '13.45');
    assert.equal(standard.vat, '2.55');
    // 10 x 1.19 = 11.90 gross, / 1.07 -> 11.1215 net, 7% -> 0.7785
    assert.equal(reduced.net, '11.12');
    assert.equal(reduced.vat, '0.78');

    const totalVat = (Number(standard.vat) + Number(reduced.vat)).toFixed(2);
    assert.equal(totalVat, Number(receipt!.sale.vatTotal).toFixed(2), 'bands sum to the recorded VAT total');
  });

  test('a sale rung up in cash is retrievable exactly like one in card', async () => {
    const posted = await checkout(org.orgId, { lines: [{ productId: milk, quantity: '1' }], tenderType: 'cash' });
    const receipt = await getSale(org.orgId, posted.id);
    assert.equal(receipt?.sale.status, 'completed');
    assert.equal(receipt?.sale.tenderType, 'cash');
  });

  test('an unknown or cross-tenant id returns null, not a crash', async () => {
    assert.equal(await getSale(org.orgId, '00000000-0000-0000-0000-000000000000'), null);
    const other = await createTestOrg('Receipt Neighbour');
    const posted = await checkout(org.orgId, { lines: [{ productId: milk, quantity: '1' }], tenderType: 'cash' });
    assert.equal(await getSale(other.orgId, posted.id), null, 'RLS, not just a filter');
  });

  test('a voided sale still shows its receipt, marked voided', async () => {
    const posted = await checkout(org.orgId, { lines: [{ productId: wine, quantity: '1' }], tenderType: 'card' });
    await voidSale(org.orgId, posted.id);
    const receipt = await getSale(org.orgId, posted.id);
    assert.equal(receipt?.sale.status, 'voided');
    assert.equal(receipt?.lines.length, 1, 'the lines are not erased, only the status changes');
  });
});
