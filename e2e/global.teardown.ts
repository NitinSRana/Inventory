import { closeDb } from './helpers';

/**
 * Closes the shared ledger connection once, after every spec has finished.
 *
 * It used to be `test.afterAll(closeDb)` in each spec. The pool is a module
 * singleton and the flows run in one worker, so whichever file finished first
 * closed the connection the next file was about to use — the second file then
 * failed on CONNECTION_ENDED before its first assertion, and took the rest of
 * its tests down with it. Ending it once, here, is the only place that knows
 * every spec is done.
 */
export default async function globalTeardown() {
  await closeDb();
}
