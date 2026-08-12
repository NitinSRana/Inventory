import { defineConfig, devices } from '@playwright/test';

import { STORAGE_STATE } from './e2e/session';

/**
 * End-to-end regression tests.
 *
 * These assert on **behaviour and data**, never on markup: role and label
 * selectors on the way in, the ledger on the way out. The visual system is being
 * rebuilt screen by screen, and a suite that breaks every time a class changes
 * is a suite people delete.
 */
export default defineConfig({
  testDir: './e2e',
  // The flows share one seeded organization and assert on its stock, so they
  // cannot run against each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // Every page here is used one-handed on a phone; test it at that size.
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app talks to Supabase in Frankfurt; from outside the EU a single
    // render is several seconds.
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },

  projects: [
    // Runs without a session, so it stays useful even when Supabase mail is
    // rate-limited or admin credentials are unavailable.
    { name: 'public', testMatch: /access\.spec\.ts/ },
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'flows',
      testMatch: /daily-loop\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: STORAGE_STATE },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000/en/sign-in',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
