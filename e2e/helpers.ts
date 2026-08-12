import postgres from 'postgres';

import { signedInUserId } from './session';

/**
 * Ledger assertions, run as the application's own role.
 *
 * The point of these tests is that a click on a phone reaches the ledger
 * correctly. Asserting only on what the page says afterwards would pass just as
 * happily if the write never happened — so every flow checks the rows.
 *
 * Deliberately uses DATABASE_URL rather than an admin connection. `app_runtime`
 * is NOBYPASSRLS, so every query here is subject to the same policies the app
 * is: an assertion cannot see a row the product could not. It also means the
 * suite needs no superuser credential to run.
 */
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });

/** Everything below runs inside a transaction with the tenant context set. */
function withOrg<T>(orgId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

let cached: string | undefined;

/**
 * The organization the signed-in user belongs to.
 *
 * Resolved through the same security-definer function the app uses, so the test
 * cannot assert against a tenant the user is not a member of.
 */
export async function currentOrgId() {
  if (cached) return cached;
  const [row] = await sql`select app.org_for_user(${signedInUserId()}) as id`;
  if (!row?.id) throw new Error('That user belongs to no organization — run `pnpm seed <email>`');
  cached = row.id as string;
  return cached;
}

export async function productByName(orgId: string, name: string) {
  const [p] = await withOrg(orgId, (tx) => tx`select id, gtin, name from products where name = ${name}`);
  if (!p) throw new Error(`No product named ${name}. Is Demo Grocer seeded?`);
  return p as unknown as { id: string; gtin: string; name: string };
}

export async function stockOnHand(orgId: string, productId: string) {
  const [row] = await withOrg(
    orgId,
    (tx) =>
      tx`select coalesce(sum(quantity_delta), 0)::text q from stock_movements where product_id = ${productId}`,
  );
  return Number((row as unknown as { q: string }).q);
}

export async function latestMovement(orgId: string, productId: string) {
  const [row] = await withOrg(
    orgId,
    (tx) => tx`
      select movement_type, quantity_delta::text delta, reason_code, reference_type
      from stock_movements where product_id = ${productId}
      order by created_at desc limit 1`,
  );
  return row as unknown as {
    movement_type: string;
    delta: string;
    reason_code: string | null;
    reference_type: string | null;
  };
}

export async function closeDb() {
  await sql.end();
}
