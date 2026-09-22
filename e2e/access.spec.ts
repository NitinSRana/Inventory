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
  '/en/checkout',
  '/en/products',
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
  // Two tabs now, as the redesign draws them: password first, the link one tap away.
  await page.goto('/en/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Magic link' }).click();
  await expect(page).toHaveURL(/\/en\/sign-in\?mode=link$/);
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveCount(0);
});

/**
 * The property under test is that a refusal never says which half was wrong —
 * not which particular refusal comes back.
 *
 * Asserting `error=password` specifically was wrong twice over. It needs the
 * throttle's own table to be reachable, which it is not in this project: CI
 * runs with a placeholder DATABASE_URL and no Postgres behind it. The throttle
 * still refuses when it cannot read its table, but it now says why —
 * `unavailable`, not `throttled` — because reporting a dead database as "too
 * many attempts" once sent someone hunting a rate limit that did not exist.
 * Run locally against a real database it passes a handful of times and then
 * trips SIGN_IN_PASSWORD_PER_EMAIL, which is the throttle working.
 *
 * All three answers are correct and none leaks membership: `throttled` and
 * `unavailable` are both decided before a credential is ever checked, so they
 * read identically for every address. All three are accepted, and what is
 * actually checked is the leak. The wrong-password wording itself
 * is pinned by the unit test on signInOutcome, which needs no Supabase.
 */
test('a refused sign-in never reveals whether the account exists', async ({ page }) => {
  await page.goto('/en/sign-in');
  // A fresh address each run, so the suite cannot throttle itself on re-runs.
  await page.getByLabel('Email').fill(`not-a-member-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/en\/sign-in\?error=(password|throttled|unavailable)$/);

  const body = await page.locator('body').innerText();
  for (const leak of ['no such', 'not found', 'unknown', 'no account', 'not registered']) {
    expect(body.toLowerCase()).not.toContain(leak);
  }
  // And it still says something, rather than failing silently. Scoped to the
  // page's own alert: Next's route announcer is also role="alert", sits outside
  // main, and would otherwise make this ambiguous.
  await expect(page.locator('main [role="alert"]')).toBeVisible();
});

/**
 * The reset form has to hold the same line as sign-in: whatever the address,
 * the answer reads the same. Accepts the throttle's two refusals for the same
 * reason the sign-in test does — CI runs with no database behind the limiter.
 */
test('asking for a password reset never reveals whether the account exists', async ({ page }) => {
  await page.goto('/en/sign-in/forgot');
  await page.getByLabel('Email').fill(`not-a-member-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Email me a reset link' }).click();

  await expect(page).toHaveURL(/\/en\/sign-in\/forgot\?(sent=1|error=(throttled|unavailable))$/);

  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const leak of ['no such', 'not found', 'unknown', 'no account', 'not registered']) {
    expect(body).not.toContain(leak);
  }
  await expect(page.locator('main [role="status"], main [role="alert"]')).toBeVisible();
});

test('the new-password screen without a reset link goes back to sign-in', async ({ page }) => {
  // No recovery session, nothing to reset: a form here could only fail.
  await page.goto('/en/sign-in/reset-password');
  await expect(page).toHaveURL(/\/en\/sign-in\?error=resetExpired$/);
  await expect(page.locator('main [role="alert"]')).toBeVisible();
});

/**
 * The access request form is the newest way to leak who is on the platform: it
 * takes an address and could easily answer differently for one it has seen
 * before. It must not.
 */
test('asking for access answers the same however many times you ask', async ({ page }) => {
  const email = `applicant-${Date.now()}@example.com`;

  const submit = async () => {
    await page.goto('/en/request-access');
    await page.getByLabel('Your name').fill('Anna Müller');
    await page.getByLabel('Shop name').fill('Anna Bio-Feinkost');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Ask for access' }).click();
    await expect(page).toHaveURL(/\/en\/request-access\?(requested=1|requestError=(throttled|unavailable))$/);
    return { url: page.url(), body: (await page.locator('main').innerText()).toLowerCase() };
  };

  const first = await submit();
  const second = await submit();

  expect(second.url).toBe(first.url);
  expect(second.body).toBe(first.body);
  // The same phrases the sign-in tests watch for. "Already" is not one of them:
  // the page's own "Already have an account?" link says nothing about this address.
  for (const leak of ['no such', 'not found', 'unknown', 'no account', 'not registered']) {
    expect(first.body).not.toContain(leak);
  }
});

test('the admin area is not there for a stranger', async ({ page }) => {
  // 404, not a redirect to sign-in: a redirect would confirm the route exists.
  for (const path of ['/en/admin', '/en/admin/requests']) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} should not exist for a signed-out visitor`).toBe(404);
  }
});
