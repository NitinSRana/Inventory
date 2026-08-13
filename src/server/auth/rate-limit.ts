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
 * Password attempts get their own buckets, not shared with magic-link's.
 * Guessing a password is the classic attack this throttle exists for — a
 * magic-link click can only ever be "right" or "expired", there is nothing to
 * brute force — so it earns its own limit rather than borrowing one sized for
 * a different threat. Slightly more headroom than magic-link's, because a
 * mistyped password is a normal, cheap mistake; a mail send is not.
 */
export const SIGN_IN_PASSWORD_PER_EMAIL: Limit = { limit: 5, windowSeconds: 15 * 60 };
export const SIGN_IN_PASSWORD_PER_CLIENT: Limit = { limit: 20, windowSeconds: 15 * 60 };

/** Postgres: relation or function does not exist. */
const UNDEFINED_OBJECT = ['42P01', '42883'];

/**
 * Records an attempt and reports whether it is allowed.
 *
 * Fails closed: if the check errors the attempt is refused. A throttle that
 * stops working under load is not a throttle.
 *
 * The one exception is the table not being there at all, which means migration
 * 0006 has not been applied to this database. That is a deployment gap, not an
 * attack, and refusing every attempt forever locks every user out of the product
 * while telling them "too many attempts" — which is both false and impossible to
 * diagnose from the outside. Allowing it restores exactly the behaviour before
 * the throttle existed, with Supabase's own per-project limit still underneath,
 * and says so on the way past.
 */
export async function checkRateLimit(bucket: string, { limit, windowSeconds }: Limit) {
  try {
    const rows = await rateLimited(
      sql`select app.check_rate_limit(${bucket}, ${limit}, make_interval(secs => ${windowSeconds})) as allowed`,
    );
    return rows[0]?.allowed === true;
  } catch (e) {
    if (UNDEFINED_OBJECT.includes(pgCode(e))) {
      console.error(
        'Rate limiting is NOT ACTIVE: app.check_rate_limit is missing. Apply migration 0006.',
      );
      return true;
    }
    return false;
  }
}

/** Drizzle wraps the driver error, so the SQLSTATE can be one level down. */
function pgCode(e: unknown): string {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code ?? '';
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
