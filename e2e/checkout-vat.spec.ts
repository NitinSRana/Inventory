import { expect, test } from '@playwright/test';

import { closeDb, currentOrgId, productByName } from './helpers';

/**
 * The money path: a basket spanning two VAT rates.
 *
 * This is the class of bug that reached the first demo — VAT added on top of
 * the shelf price instead of extracted from it — and no unit test catches it,
 * because the till, the VAT seed data and the product's own band all have to
 * be wrong together for the bug to show up end to end. Asserting the number
 * a real shopper hands over is the only test that would have caught it.
 */

// Reduced-rate (7%) and standard-rate (19%) under real German VAT law — most
// groceries are reduced, bottled water is not. See scripts/seed.mts.
const REDUCED = 'Spaghetti 500g'; // 1.29
const STANDARD = 'Mineralwasser 6x1,5L'; // 3.49

let orgId: string;
let reduced: { id: string; gtin: string; name: string };
let standard: { id: string; gtin: string; name: string };

test.beforeAll(async () => {
  orgId = await currentOrgId();
  reduced = await productByName(orgId, REDUCED);
  standard = await productByName(orgId, STANDARD);
});

test.afterAll(closeDb);

test('a mixed-VAT basket totals exactly the sum of the shelf prices', async ({ page }) => {
  await page.goto('/en/checkout');

  await page.getByLabel('Barcode').fill(reduced.gtin);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText(reduced.name)).toBeVisible();
  await page.getByLabel('Quantity').fill('1');
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await page.getByLabel('Barcode').fill(standard.gtin);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText(standard.name)).toBeVisible();
  await page.getByLabel('Quantity').fill('1');
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await page.getByRole('button', { name: 'Card' }).click();
  await expect(page.getByText('Sale complete')).toBeVisible();

  // 1.29 (7%) + 3.49 (19%) — exactly the two shelf prices, nothing added.
  await expect(page.getByText('€4.78', { exact: false })).toBeVisible();
});
