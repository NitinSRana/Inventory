import { defineConfig, devices } from '@playwright/test';

import { STORAGE_STATE } from './e2e/session';

// An empty string is not an address. `??` would accept one and every navigation
// would fail with "cannot navigate to invalid URL", which reads like a browser
// fault rather than a missing variable.
const EXTERNAL = process.env.E2E_BASE_URL || undefined;
const LOCAL = 'http://localhost:3000';

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
    baseURL: EXTERNAL ?? LOCAL,
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

  webServer: EXTERNAL
    ? undefined
    : {
        command: 'pnpm dev',
        url: `${LOCAL}/en/sign-in`,
        // CI starts from nothing and must not inherit a stray server; locally,
        // reusing the one already running saves a minute per run.
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
