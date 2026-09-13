// The edit page is the one place the app calls updateProduct, and updateProduct
// treats an identifier it is not given as "clear it". So whatever the form fails
// to post, saving erases — which is exactly how every edited product was losing
// its SKU.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { productInputFrom } from '@/components/product-form';
import { createTestOrg } from '@/server/testing/fixtures';

import { createProduct, getProduct, updateProduct } from './products';

describe('editing a product through its form', () => {
  test('saving a price change keeps the SKU, the barcode and the shelf', async () => {
    const org = await createTestOrg('Product Edit');
    const product = await createProduct(org.orgId, {
      name: 'Vollmilch 1L',
      gtin: '4001234567891',
      sku: 'VM1L',
      sellPrice: '1.2900',
      shelfLocation: 'Fridge Row 2',
    });

    // What the edit page posts when someone changes only the price.
    const form = new FormData();
    form.set('name', 'Vollmilch 1L');
    form.set('gtin', '4001234567891');
    form.set('sku', 'VM1L');
    form.set('sellPrice', '1.35');
    form.set('shelfLocation', 'Fridge Row 2');
    await updateProduct(org.orgId, product.id, productInputFrom(form));

    const saved = await getProduct(org.orgId, product.id);
    assert.equal(saved?.sellPrice, '1.3500');
    assert.equal(saved?.sku, 'VM1L', 'the form has to post the SKU, or saving erases it');
    assert.equal(saved?.gtin, '4001234567891');
    assert.equal(saved?.shelfLocation, 'Fridge Row 2');
  });
});
