import { expect, test } from '@playwright/test';

/**
 * The other half of sign-in: what a stranger gets.
 *
 * Worth its own file because it must run without the saved session, and because
 * a missing redirect here is not a cosmetic bug — every one of these pages
 * queries a tenant.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const PROTECTED = [
  '/en/receive',
  '/en/count',
  '/en/waste',
  '/en/checkout',
  '/en/reorder',
  '/en/products',
  '/en/orders',
  '/en/categories',
  '/en/settings/store',
];

for (const path of PROTECTED) {
  test(`${path} sends a signed-out visitor to sign-in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });
}

test('the sign-in form offers a password and a mail link, not just one', async ({ page }) => {
  await page.goto('/en/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
});

test('a wrong password is refused without saying whether the account exists', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill('not-a-real-member@example.com');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/en\/sign-in\?error=password$/);
  await expect(page.getByText('Wrong email or password.')).toBeVisible();
});
