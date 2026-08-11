import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// `prepare: false` is required behind Supabase's transaction pooler, which does
// not support prepared statements.
const client = postgres(connectionString, { prepare: false });

// Deliberately NOT exported. Every caller goes through withTenant, so a query
// without org context is impossible to write rather than merely discouraged.
const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Opens a transaction with the tenant's org id set, so RLS scopes every query
 * inside it. Outside of this, tenant tables return zero rows.
 *
 * Never pass an orgId that came from the client — derive it from the session.
 */
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) = transaction-scoped, so it cannot leak across
    // requests sharing a pooled connection. The `true` is load-bearing.
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * The one query that legitimately runs without org context: finding which org a
 * user belongs to, which is what withTenant needs before it can do anything.
 *
 * organization_members is RLS-protected by organization_id, so this goes through
 * app.org_for_user() — a security definer function that exists for exactly this
 * lookup. See supabase/migrations/0002_app_runtime_role.sql.
 */
/**
 * Claims a pending invitation for this email, if there is one, and returns the
 * organization it joined.
 *
 * The other query that legitimately runs without org context — same reason as
 * orgForUser: the caller has no tenant yet, so it cannot read an RLS-protected
 * table to discover the one inviting it. Idempotent; see
 * supabase/migrations/0004_organization_invitations.sql.
 */
export async function claimInvitation(userId: string, email: string): Promise<string | null> {
  const rows = await db.execute<{ org: string | null }>(
    sql`select app.claim_invitation(${userId}::uuid, ${email}) as org`,
  );
  return rows[0]?.org ?? null;
}

/**
 * Runs an `app` schema function that has nothing to do with tenants.
 *
 * Rate limiting happens before anyone is signed in, so there is no organization
 * to scope to. Kept here rather than opening up `db`, so every route into the
 * database still passes through this one file.
 */
export async function rateLimited<T extends Record<string, unknown>>(query: SQL) {
  return db.execute<T>(query);
}

export async function orgForUser(userId: string): Promise<string | null> {
  const rows = await db.execute<{ org: string | null }>(
    sql`select app.org_for_user(${userId}::uuid) as org`,
  );
  return rows[0]?.org ?? null;
}
