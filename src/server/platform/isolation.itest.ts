// The platform tables sit outside the tenant model, which is exactly why they
// need their own isolation test: RLS is not protecting them — schema privilege
// is, and a privilege nobody checks is one somebody eventually grants.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sql } from 'drizzle-orm';

import { organizations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { adminSql, createTestOrg } from '@/server/testing/fixtures';

describe('platform tables seen from inside a tenant', () => {
  test('a shop cannot read the signup queue, even with a row in it', async () => {
    const shop = await createTestOrg('Nosy Grocer');
    // Seeded first, so a pass cannot mean "the table happened to be empty".
    await adminSql`
      insert into app.signup_requests (email, contact_name, shop_name, country_code)
      values ('someone@example.com', 'Someone', 'Someone Else Grocer', 'DE')`;

    await assert.rejects(
      () => withTenant(shop.orgId, (tx) => tx.execute(sql`select * from app.signup_requests`)),
      (e: { code?: string; cause?: { code?: string } }) => {
        // 42501: insufficient privilege. app_runtime has no grant on this table,
        // which is the whole reason it lives in the `app` schema.
        const code = e?.code ?? e?.cause?.code;
        assert.equal(code, '42501', `expected permission denied, got ${code}`);
        return true;
      },
    );
  });

  test('a shop still sees only itself', async () => {
    const mine = await createTestOrg('Mine Grocer');
    await createTestOrg('Yours Grocer');

    const rows = await withTenant(mine.orgId, (tx) => tx.select().from(organizations));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Mine Grocer');
  });

  test('app.platform_shops() is callable from a tenant context — on purpose, and documented', async () => {
    // Postgres cannot tell who the platform owner is: the app connects as
    // app_runtime with no JWT, so execute is granted to it and authorization
    // lives in requirePlatformAdmin. Pinned here so the next person finds the
    // decision rather than assuming the database enforces it.
    const shop = await createTestOrg('Aware Grocer');
    const rows = await withTenant(shop.orgId, (tx) =>
      tx.execute<{ name: string }>(sql`select name from app.platform_shops()`),
    );
    assert.ok(rows.length >= 1, 'it answers, and the TypeScript layer is what refuses');
  });

  test('the aggregate counts a shop once and reports what it holds', async () => {
    const shop = await createTestOrg('Counted Grocer');
    const rows = await withTenant(shop.orgId, (tx) =>
      tx.execute<{ name: string; member_count: number; product_count: number; sale_count: number }>(
        sql`select name, member_count, product_count, sale_count from app.platform_shops() where name = 'Counted Grocer'`,
      ),
    );
    assert.equal(rows.length, 1, 'one row per shop, not one per member');
    assert.equal(rows[0].member_count, 1);
    assert.equal(rows[0].product_count, 0, 'a new shop starts empty — nobody inherits a catalogue');
    assert.equal(rows[0].sale_count, 0);
  });
});
