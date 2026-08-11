import { expect, test } from '@playwright/test';

/**
 * The other half of sign-in: what a stranger gets.
 *
 * Worth its own file because it must run without the saved session, and because
 * a missing redirect here is not a cosmetic bug — every one of these pages
 * queries a tenant.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const PROTECTED = ['/en/receive', '/en/count', '/en/waste', '/en/reorder', '/en/products', '/en/orders'];

for (const path of PROTECTED) {
  test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });
}

test('the sign-in form asks for a link rather than a password', async ({ page }) => {
  await page.goto('/en/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
});
