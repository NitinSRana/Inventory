/**
 * Captures a real signed-in session for the end-to-end suite.
 *
 * Opens a browser window, waits for you to sign in the way any shopkeeper would,
 * and saves the resulting cookies. That is the whole job.
 *
 * It exists because the product has no password: sign-in is a magic link, so a
 * test cannot type its way in. The alternative — a test-only authentication
 * bypass in the app — would be a permanent hole in the one thing the suite
 * could never catch, in exchange for saving you thirty seconds once a month.
 *
 *   pnpm e2e:session
 *
 * Nothing is typed into this terminal and no credential is stored: the session
 * lands in e2e/.auth/owner.json, which is gitignored.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = 'e2e/.auth/owner.json';
const WAIT_MS = 10 * 60 * 1000;

mkdirSync('e2e/.auth', { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${BASE}/en/sign-in`);

console.log(`
A browser window is open at ${BASE}/en/sign-in.

  1. Enter your email and ask for a link.
  2. When the mail arrives, paste the link into *that* window's address bar.
     Opening it in your normal browser signs that browser in, not this one.

Waiting up to 10 minutes for the shop to appear...`);

try {
  await page.waitForSelector('nav[aria-label="Main"]', { timeout: WAIT_MS });
  await context.storageState({ path: OUT });
  console.log(`\nSaved to ${OUT}. Run: pnpm test:e2e`);
} catch {
  console.error('\nNo signed-in shop appeared. Nothing was saved.');
  process.exitCode = 1;
} finally {
  await browser.close();
}
