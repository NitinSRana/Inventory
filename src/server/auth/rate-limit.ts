import { sql } from 'drizzle-orm';

import { rateLimited } from '@/db/tenant';

/**
 * Throttling for actions that can be triggered before anyone is signed in.
 *
 * The sign-in action sends mail to whatever address is posted to it. Left
 * unthrottled that is two problems at once: someone can flood a stranger's
 * inbox, and they can exhaust the project's mail quota so the shop's own staff
 * cannot sign in. Supabase's limits are per-project, so one abuser locks out
 * every tenant.
 */

export type Limit = { limit: number; windowSeconds: number };

/**
 * Two buckets per sign-in attempt, deliberately.
 *
 * The per-address bucket protects the owner of that mailbox. The per-client one
 * stops someone walking through a list of addresses, which the first bucket
 * alone would never notice.
 */
export const SIGN_IN_PER_EMAIL: Limit = { limit: 3, windowSeconds: 15 * 60 };
export const SIGN_IN_PER_CLIENT: Limit = { limit: 10, windowSeconds: 15 * 60 };

/**
 * Records an attempt and reports whether it is allowed.
 *
 * Fails closed: if the check itself errors the attempt is refused. A throttle
 * that stops working under load is not a throttle.
 */
export async function checkRateLimit(bucket: string, { limit, windowSeconds }: Limit) {
  try {
    const rows = await rateLimited(
      sql`select app.check_rate_limit(${bucket}, ${limit}, make_interval(secs => ${windowSeconds})) as allowed`,
    );
    return rows[0]?.allowed === true;
  } catch {
    return false;
  }
}

/**
 * Buckets are hashed, not stored raw: this table would otherwise be a list of
 * every email address anyone has tried to sign in with, sitting outside the
 * tenant model with no reason to hold personal data.
 */
export async function hashedBucket(kind: string, value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${kind}:${hex.slice(0, 32)}`;
}
