import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page, test as setup } from '@playwright/test';
import postgres from 'postgres';

import { STORAGE_STATE } from './session';

/**
 * Establishes the session every flow runs against.
 *
 * The product has no password — sign-in is a magic link — so there is nothing to
 * type. Two ways to get a real session:
 *
 * 1. Mint a one-time token and redeem it through the app's own /auth/confirm.
 *    Exercises the genuine auth path, but reads `auth.one_time_tokens`, which
 *    the application role cannot see and correctly so. Needs ADMIN_DATABASE_URL.
 *
 * 2. Reuse a session saved by `pnpm e2e:session`. No credentials at all.
 *
 * Either way the session is real and the app is none the wiser: there is no
 * test-only authentication bypass anywhere in production code, which is the one
 * thing this suite could never catch.
 */
setup('authenticate', async ({ page }) => {
  const reasons: string[] = [];

  const ok =
    (await tryMintedToken(page, reasons)) || (await trySavedSession(page, reasons));
  if (!ok) {
    throw new Error(
      `Could not establish a session.\n  ${reasons.join('\n  ')}\n\n` +
        'Run `pnpm e2e:session` to sign in once by hand, or fix ADMIN_DATABASE_URL.',
    );
  }

  // Proof the session is real: the shell only renders for a resolved tenant.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});

async function tryMintedToken(page: Page, reasons: string[]) {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl) {
    reasons.push('ADMIN_DATABASE_URL is not set.');
    return false;
  }

  const email = process.env.E2E_EMAIL ?? 'nitinrana.manager@gmail.com';
  const sql = postgres(adminUrl, { prepare: false, max: 1, connect_timeout: 20 });
  try {
    const [user] = await sql`select id from auth.users where email = ${email}`;
    if (!user) throw new Error(`no Supabase user for ${email}`);

    // Ask the app to issue a link the same way the sign-in form does, then read
    // the token straight from the database rather than an inbox.
    await page.goto('/en/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Email me a link' }).click();

    const [token] = await sql`
      select token_hash from auth.one_time_tokens
      where user_id = ${user.id} order by created_at desc limit 1`;
    if (!token) throw new Error('no token was issued — check the Supabase mail rate limit');

    await page.goto(`/auth/confirm?token_hash=${token.token_hash}&type=magiclink&next=/en`);
    return true;
  } catch (e) {
    // A wrong password here is not fatal: a saved session may still work, and
    // failing hard on the preferred path would hide the one that does.
    reasons.push(`Minting a token failed: ${(e as Error).message}`);
    return false;
  } finally {
    await sql.end();
  }
}

async function trySavedSession(page: Page, reasons: string[]) {
  if (!existsSync(STORAGE_STATE)) {
    reasons.push(`No saved session at ${STORAGE_STATE}.`);
    return false;
  }
  const saved = JSON.parse(readFileSync(STORAGE_STATE, 'utf8'));
  await page.context().addCookies(saved.cookies ?? []);
  await page.goto('/en');
  return true;
}
