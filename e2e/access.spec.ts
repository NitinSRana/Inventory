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
  '/en/insights',
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

/**
 * The property under test is that a refusal never says which half was wrong —
 * not which particular refusal comes back.
 *
 * Asserting `error=password` specifically was wrong twice over. It needs the
 * throttle's own table to be reachable, which it is not in this project: CI
 * runs with a placeholder DATABASE_URL and no Postgres behind it, and the
 * throttle fails closed, so every attempt legitimately returns `throttled`.
 * Run locally against a real database it passes a handful of times and then
 * trips SIGN_IN_PASSWORD_PER_EMAIL, which is the throttle working.
 *
 * Both answers are correct and neither leaks membership, so both are accepted
 * and what is actually checked is the leak. The wrong-password wording itself
 * is pinned by the unit test on signInOutcome, which needs no Supabase.
 */
test('a refused sign-in never reveals whether the account exists', async ({ page }) => {
  await page.goto('/en/sign-in');
  // A fresh address each run, so the suite cannot throttle itself on re-runs.
  await page.getByLabel('Email').fill(`not-a-member-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/en\/sign-in\?error=(password|throttled)$/);

  const body = await page.locator('body').innerText();
  for (const leak of ['no such', 'not found', 'unknown', 'no account', 'not registered']) {
    expect(body.toLowerCase()).not.toContain(leak);
  }
  // And it still says something, rather than failing silently. Scoped to the
  // page's own alert: Next's route announcer is also role="alert", sits outside
  // main, and would otherwise make this ambiguous.
  await expect(page.locator('main [role="alert"]')).toBeVisible();
});
