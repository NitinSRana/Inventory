import postgres from 'postgres';

/**
 * Direct database access for assertions.
 *
 * The point of these tests is that a click on a phone reaches the ledger
 * correctly. Asserting only on what the page says afterwards would pass just as
 * happily if the write never happened — so every flow checks the rows.
 */
const sql = postgres(process.env.ADMIN_DATABASE_URL!, { prepare: false, max: 2 });

export async function demoOrgId() {
  const [org] = await sql`select id from organizations where name = 'Demo Grocer'`;
  if (!org) throw new Error('Demo Grocer is missing — run `pnpm seed <email>` first');
  return org.id as string;
}

export async function productByName(orgId: string, name: string) {
  const [p] = await sql`
    select id, gtin, name from products
    where organization_id = ${orgId} and name = ${name}`;
  if (!p) throw new Error(`No product named ${name}`);
  return p as { id: string; gtin: string; name: string };
}

export async function stockOnHand(orgId: string, productId: string) {
  const [row] = await sql`
    select coalesce(sum(quantity_delta), 0)::text q from stock_movements
    where organization_id = ${orgId} and product_id = ${productId}`;
  return Number(row.q);
}

export async function movementCount(orgId: string, type: string) {
  const [row] = await sql`
    select count(*)::int n from stock_movements
    where organization_id = ${orgId} and movement_type = ${type}`;
  return row.n as number;
}

export async function latestMovement(orgId: string, productId: string) {
  const [row] = await sql`
    select movement_type, quantity_delta::text delta, reason_code, reference_type
    from stock_movements
    where organization_id = ${orgId} and product_id = ${productId}
    order by created_at desc limit 1`;
  return row as { movement_type: string; delta: string; reason_code: string | null; reference_type: string | null };
}

export async function closeDb() {
  await sql.end();
}
