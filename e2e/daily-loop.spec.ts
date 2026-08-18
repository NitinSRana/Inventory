import { expect, test } from '@playwright/test';

import { closeDb, currentOrgId, latestMovement, productByName, stockOnHand } from './helpers';

/**
 * The daily loop: receive, count, sell.
 *
 * Each test drives the real UI with role and label selectors, then reads the
 * ledger to prove the click actually landed. A page that says "Delivery
 * recorded" while writing nothing would pass a screenshot test and fail this
 * one — which is the whole point, because the screens are being restyled
 * underneath it.
 */

// Long shelf life and no expiry pressure, so moving its stock around does not
// perturb the expiry dashboard the other assertions read.
const PRODUCT = 'Spaghetti 500g';

let orgId: string;
let product: { id: string; gtin: string; name: string };

test.beforeAll(async () => {
  orgId = await currentOrgId();
  product = await productByName(orgId, PRODUCT);
});

test.afterAll(closeDb);

test.describe('daily loop', () => {
  test('the shell only renders for a signed-in member', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Demo Grocer' })).toBeVisible();
  });

  test('receiving a delivery adds stock', async ({ page }) => {
    const before = await stockOnHand(orgId, product.id);

    await page.goto('/en/receive');
    await page.getByLabel('Barcode').fill(product.gtin);
    await page.getByRole('button', { name: 'Look up' }).click();

    await expect(page.getByText(product.name)).toBeVisible();
    await page.getByLabel(/Quantity received/).fill('12');
    await page.getByRole('button', { name: 'Receive', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText('Delivery recorded.');

    expect(await stockOnHand(orgId, product.id)).toBe(before + 12);
    const movement = await latestMovement(orgId, product.id);
    expect(movement.movement_type).toBe('receipt');
    expect(Number(movement.delta)).toBe(12);
  });

  test('a count posts an adjustment that reconciles the ledger', async ({ page }) => {
    const expected = await stockOnHand(orgId, product.id);
    // Deliberately off by two, which is what a variance looks like in real life.
    const counted = expected - 2;

    await page.goto('/en/count');
    await page.getByLabel('What are you counting?').fill('E2E aisle');
    await page.getByRole('button', { name: 'Start count' }).click();

    await page.getByLabel('Barcode').fill(product.gtin);
    await page.getByRole('button', { name: 'Look up' }).click();
    await page.getByLabel(/^Counted \(/).fill(String(counted));
    await page.getByRole('button', { name: 'Save and next' }).click();

    await page.getByRole('link', { name: 'Review and finish' }).click();
    await expect(page.getByText(`expected ${expected}`, { exact: false })).toBeVisible();

    // Nothing is written until this button; everything before it was reversible.
    await page.getByRole('button', { name: /Post \d+ adjustment/ }).click();
    await expect(page).toHaveURL(/\/en$/);

    expect(await stockOnHand(orgId, product.id)).toBe(counted);
    const movement = await latestMovement(orgId, product.id);
    expect(movement.movement_type).toBe('count_adjustment');
    expect(Number(movement.delta)).toBe(-2);
  });

  test('a checkout sale depletes stock and posts as consumption, not waste', async ({ page }) => {
    const before = await stockOnHand(orgId, product.id);

    await page.goto('/en/checkout');
    await page.getByLabel('Barcode').fill(product.gtin);
    await page.getByRole('button', { name: 'Look up' }).click();

    await expect(page.getByText(product.name)).toBeVisible();
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Add to cart' }).click();

    // Tender is the completing action — no separate confirm step behind it.
    await expect(page.getByRole('button', { name: 'Card' })).toBeVisible();
    await page.getByRole('button', { name: 'Card' }).click();

    await expect(page.getByText('Sale complete')).toBeVisible();

    expect(await stockOnHand(orgId, product.id)).toBe(before - 2);
    const movement = await latestMovement(orgId, product.id);
    expect(movement.movement_type).toBe('consumption');
    expect(movement.reference_type).toBe('sale');
    expect(Number(movement.delta)).toBe(-2);
  });
});
