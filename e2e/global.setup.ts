import { expect, test as setup } from '@playwright/test';
import postgres from 'postgres';

/**
 * Signs in once and saves the session for every flow.
 *
 * The product has no password — sign-in is a magic link — so this mints a real
 * one-time token and redeems it through the app's own `/auth/confirm` route.
 * That exercises the genuine auth path rather than forging a cookie, and it
 * means there is no test-only bypass in production code.
 *
 * Needs ADMIN_DATABASE_URL: `auth.one_time_tokens` is not readable by the
 * application role, and correctly so.
 */
setup('authenticate', async ({ page }) => {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const email = process.env.E2E_EMAIL ?? 'nitinrana.manager@gmail.com';
  if (!adminUrl) throw new Error('ADMIN_DATABASE_URL is required to mint a sign-in token');

  const sql = postgres(adminUrl, { prepare: false, max: 1 });
  try {
    const [user] = await sql`select id from auth.users where email = ${email}`;
    if (!user) throw new Error(`No Supabase user for ${email}. Sign in once by hand first.`);

    // Ask the app to issue a link the same way the sign-in form does, then read
    // the token straight from the database rather than an inbox.
    await page.goto('/en/sign-in');
    await page.getByLabel(/email/i).fill(email);
    await page.getByRole('button', { name: /link/i }).click();

    const [token] = await sql`
      select token_hash from auth.one_time_tokens
      where user_id = ${user.id} order by created_at desc limit 1`;
    if (!token) throw new Error('No sign-in token was issued — check the Supabase mail rate limit');

    await page.goto(
      `/auth/confirm?token_hash=${token.token_hash}&type=magiclink&next=/en`,
    );

    // Proof the session is real: the shell only renders for a resolved tenant.
    await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible();
    await page.context().storageState({ path: 'e2e/.auth/owner.json' });
  } finally {
    await sql.end();
  }
});
